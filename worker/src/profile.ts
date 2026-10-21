// A signed-in player's profile (plan 2026-10-19, items 8 and 9): tester badges and game stats, read from
// what is already stored (test_verdicts with plays, user_history outcomes, daily_scores). Nothing new is
// recorded for it. The public page (/p/<handle>) shows only this, and only when the player turns it on.

export type Profile = {
  handle: string | null;
  public: boolean;
  verdicts: number;          // stories they gave a tester verdict on
  passed: number;
  badges: { name: string; why: string }[];
  bestStreak: number | null;
  boardsCleared: number;
  finished: number;          // plays that reached an ending of any kind
  campaigns: number;
  teams: string[];
  dailies: { day: string; score: number; top: number }[];
};

// Tester badges: plain words, no images (voice first).
const FOUNDING_UNTIL = Date.UTC(2027, 0, 1);
function badgesFor(verdicts: number, firstVerdictAt: number | null): { name: string; why: string }[] {
  const out: { name: string; why: string }[] = [];
  if (verdicts >= 1) out.push({ name: "Tester", why: "gave a verdict on a story being tested" });
  if (verdicts >= 5) out.push({ name: "Regular tester", why: "five or more verdicts" });
  if (verdicts >= 10 && firstVerdictAt !== null && firstVerdictAt < FOUNDING_UNTIL) out.push({ name: "Founding tester", why: "ten or more verdicts, starting in 2026" });
  return out;
}

export async function profileOf(db: D1Database | undefined, userId: string): Promise<Profile | null> {
  if (!db) return null;
  try {
    const [u, v, h, d] = await db.batch([
      db.prepare("SELECT handle, public FROM users WHERE id = ?").bind(userId),
      db.prepare("SELECT count(*) AS n, sum(CASE WHEN tv.verdict = 'passed' THEN 1 ELSE 0 END) AS passed, min(tv.at) AS first_at FROM test_verdicts tv JOIN plays p ON p.id = tv.play_id WHERE p.user_id = ?").bind(userId),
      db.prepare("SELECT story, title, kind, outcome FROM user_history WHERE user_id = ?").bind(userId),
      db.prepare("SELECT d.day, d.score, (SELECT max(score) FROM daily_scores x WHERE x.day = d.day) AS top FROM daily_scores d WHERE d.user_id = ? ORDER BY d.day DESC LIMIT 14").bind(userId),
    ]);
    const user = (u.results?.[0] ?? {}) as { handle?: string | null; public?: number };
    const ver = (v.results?.[0] ?? {}) as { n?: number; passed?: number; first_at?: number | null };
    const hist = (h.results ?? []) as { story: string; title: string; kind: string; outcome: string | null }[];
    const streaks = hist.map((r) => /^streak (\d+)/.exec(r.outcome ?? "")?.[1]).filter(Boolean).map(Number);
    const verdicts = Number(ver.n ?? 0);
    return {
      handle: user.handle ?? null,
      public: Boolean(user.public),
      verdicts,
      passed: Number(ver.passed ?? 0),
      badges: badgesFor(verdicts, ver.first_at ?? null),
      bestStreak: streaks.length ? Math.max(...streaks) : null,
      boardsCleared: hist.filter((r) => /^board cleared/.test(r.outcome ?? "")).length,
      finished: hist.filter((r) => r.outcome).length,
      campaigns: new Set(hist.filter((r) => r.kind === "campaign").map((r) => r.story)).size,
      teams: [...new Set(hist.map((r) => /^Team Trivia: (.+)$/.exec(r.title)?.[1]).filter((x): x is string => Boolean(x)))].slice(0, 12),
      dailies: ((d.results ?? []) as { day: string; score: number; top: number }[]).map((r) => ({ day: r.day, score: Number(r.score), top: Number(r.top) })),
    };
  } catch {
    return null;
  }
}

// Handles: 3-20 lower-case letters, digits and single hyphens; not a reserved word, not offensive, and
// not a protected name (the lint's denylist). Screened again on every save.
const RESERVED = /^(admin|administrator|plotspeaks|plot-speaks|volocent|support|help|account|accounts|api|mcp|root|staff|moderator|official|team|null|undefined)$/;
const OFFENSIVE = /(fuck|shit|cunt|nigg|fag|rape|nazi|hitler|porn|penis|vagina|cock|dick|pussy|whore|slut|bitch|kkk|retard|tits|anal|cum)/;
export function checkHandle(raw: string, denylist: string[]): { handle: string } | { error: string } {
  const h = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,18}[a-z0-9]$/.test(h)) return { error: "invalid" };
  if (RESERVED.test(h) || OFFENSIVE.test(h.replace(/-/g, ""))) return { error: "not-allowed" };
  const spaced = h.replace(/-/g, " ");
  if (denylist.some((t) => new RegExp(`(^|\\s)${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(spaced))) return { error: "not-allowed" };
  return { handle: h };
}

export async function saveProfile(db: D1Database, userId: string, handle: string | null, isPublic: boolean): Promise<"saved" | "taken"> {
  try {
    await db.prepare("UPDATE users SET handle = ?, public = ? WHERE id = ?").bind(handle, handle && isPublic ? 1 : 0, userId).run();
    return "saved";
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return "taken";
    throw e;
  }
}

export async function publicProfile(db: D1Database | undefined, handle: string): Promise<Profile | null> {
  if (!db || !/^[a-z0-9-]{3,20}$/.test(handle)) return null;
  try {
    const row = await db.prepare("SELECT id FROM users WHERE handle = ? AND public = 1").bind(handle).first<{ id: string }>();
    return row ? await profileOf(db, row.id) : null;
  } catch { return null; }
}

/** One line for the host (my_history): the badges and the stats worth saying aloud. */
export function profileLine(p: Profile): string {
  const bits = [
    p.badges.length ? `badges: ${p.badges.map((b) => b.name).join(", ")}` : null,
    p.verdicts ? `${p.verdicts} tester ${p.verdicts === 1 ? "verdict" : "verdicts"}` : null,
    p.bestStreak !== null ? `best trivia streak ${p.bestStreak}` : null,
    p.boardsCleared ? `${p.boardsCleared} ${p.boardsCleared === 1 ? "board" : "boards"} cleared` : null,
  ].filter(Boolean);
  return bits.length ? `PROFILE: ${bits.join("; ")}.` : "";
}
