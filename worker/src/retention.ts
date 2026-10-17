// Daily log retention (Cron Trigger, see wrangler.jsonc "triggers"). Idempotent: each statement
// deletes or clears rows by age, so running it twice, or after a missed day, does the same thing.
// Cheap: one batch of five statements on indexed columns; on a quiet day each touches zero rows.
//
//   plays, play_events           deleted after 90 days (Gate 2's running count lives in totals, so it
//                                survives this); events whose play is gone go with it, so a late
//                                accusation on an old play can't linger as an orphan
//   submission_attempts          deleted after 2 days (they only feed the 24-hour submit caps)
//   submissions, status rejected deleted 90 days after review (or submission, if never reviewed)
//   ratings                      kept; the free-text comment and feedback are cleared after 90 days
//   submissions, pending/approved kept (approved stories are the catalog)
//   daily_counts                 deleted after 400 days (counts only, no personal data; src/usage.ts)
//   completions                  deleted after 90 days (Gate 2 markers; the count stays in totals)

const DAY = 24 * 60 * 60 * 1000;
export const KEEP_DAYS = 90;
export const ATTEMPT_DAYS = 2;
export const COUNT_DAYS = 400;

export async function runRetention(db: D1Database | undefined, now = Date.now()): Promise<Record<string, number>> {
  if (!db) return {};
  const old = now - KEEP_DAYS * DAY;
  const steps: [string, D1PreparedStatement][] = [
    ["play_events", db.prepare("DELETE FROM play_events WHERE at < ?").bind(old)],
    ["plays", db.prepare("DELETE FROM plays WHERE started_at < ?").bind(old)],
    // Passenger-page events have no play (play_id NULL) and are kept by age alone.
    ["orphan_events", db.prepare("DELETE FROM play_events WHERE play_id IS NOT NULL AND play_id NOT IN (SELECT id FROM plays)")],
    ["submission_attempts", db.prepare("DELETE FROM submission_attempts WHERE at < ?").bind(now - ATTEMPT_DAYS * DAY)],
    ["rejected_submissions", db.prepare("DELETE FROM submissions WHERE status = 'rejected' AND coalesce(reviewed_at, created_at) < ?").bind(old)],
    ["rating_comments", db.prepare("UPDATE ratings SET comment = NULL, feedback = NULL WHERE at < ? AND (comment IS NOT NULL OR feedback IS NOT NULL)").bind(old)],
  ];
  const results = await db.batch(steps.map(([, s]) => s));
  const counts: Record<string, number> = {};
  steps.forEach(([name], i) => { counts[name] = results[i]?.meta?.changes ?? 0; });
  // Separate from the batch: daily_counts arrives with migration 0004, and a missing table must
  // not stop the deletions above.
  try {
    const cutoff = new Date(now - COUNT_DAYS * DAY).toISOString().slice(0, 10);
    counts.daily_counts = (await db.prepare("DELETE FROM daily_counts WHERE day < ?").bind(cutoff).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // Gate 2 completion markers (migration 0006): only needed while their play row exists, so they
  // go at 90 days too; the count itself lives on in totals.
  try {
    counts.completions = (await db.prepare("DELETE FROM completions WHERE at < ?").bind(old).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  return counts;
}
