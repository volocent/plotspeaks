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
    // A campaign played within 90 days keeps its play, however long ago it started.
    ["plays", db.prepare("DELETE FROM plays WHERE started_at < ? AND id NOT IN (SELECT play_id FROM play_state WHERE kind = 'campaign' AND updated_at >= ?)").bind(old, old)],
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
  // Connect-check notes (migration 0018): the typed note goes at 90 days; the yes/no and the problem stay.
  try {
    counts.connect_notes = (await db.prepare("UPDATE connect_feedback SET note = NULL WHERE at < ? AND note IS NOT NULL").bind(old).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // GitHub totals (migration 0017): as long as the counts.
  try {
    const cutoff = new Date(now - COUNT_DAYS * DAY).toISOString().slice(0, 10);
    counts.github_counts = (await db.prepare("DELETE FROM github_counts WHERE day < ?").bind(cutoff).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // Watch codes (migration 0021): a day.
  try {
    counts.watch_codes = (await db.prepare("DELETE FROM watch_codes WHERE created_at < ?").bind(now - DAY).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // Shared path codes (migration 0020): thirty days.
  try {
    counts.path_codes = (await db.prepare("DELETE FROM path_codes WHERE created_at < ?").bind(now - 30 * DAY).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // Head-to-head codes (migration 0015): thirty days.
  try {
    counts.board_codes = (await db.prepare("DELETE FROM board_codes WHERE created_at < ?").bind(now - 30 * DAY).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // The daily board's scores (migration 0013): kept as long as the counts.
  try {
    const cutoff = new Date(now - COUNT_DAYS * DAY).toISOString().slice(0, 10);
    counts.daily_scores = (await db.prepare("DELETE FROM daily_scores WHERE day < ?").bind(cutoff).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // A tester's verdict (migration 0011) is kept; its suggestion is cleared at 90 days like a comment.
  try {
    counts.verdict_feedback = (await db.prepare("UPDATE test_verdicts SET feedback = NULL WHERE at < ? AND feedback IS NOT NULL").bind(old).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // Play state (migration 0008): where a choose-your-path play is; goes with its play.
  try {
    counts.play_state = (await db.prepare("DELETE FROM play_state WHERE updated_at < ? OR play_id NOT IN (SELECT id FROM plays)").bind(old).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // Accounts (migration 0010): expired sessions go; an account unused for two years goes with its history.
  try {
    counts.sessions = (await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run()).meta?.changes ?? 0;
    const stale = now - 730 * DAY;
    const r = await db.batch([
      db.prepare("DELETE FROM user_history WHERE user_id IN (SELECT id FROM users WHERE last_seen_at < ?)").bind(stale),
      db.prepare("DELETE FROM user_seen WHERE user_id IN (SELECT id FROM users WHERE last_seen_at < ?)").bind(stale),
      db.prepare("DELETE FROM users WHERE last_seen_at < ?").bind(stale),
    ]);
    counts.stale_accounts = r[2]?.meta?.changes ?? 0;
  } catch { /* tables not there yet */ }
  try {
    counts.campaign_codes = (await db.prepare("DELETE FROM campaign_codes WHERE play_id NOT IN (SELECT id FROM plays)").run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  // Gate 2 completion markers (migration 0006): only needed while their play row exists, so they
  // go at 90 days too; the count itself lives on in totals.
  try {
    counts.completions = (await db.prepare("DELETE FROM completions WHERE at < ?").bind(old).run()).meta?.changes ?? 0;
  } catch { /* table not there yet */ }
  return counts;
}
