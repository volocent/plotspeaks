// GET /admin/stats.json?days=N (key-gated in submissions.ts handleAdmin, like the rest of /admin):
// the usage numbers the owner's admin dashboard and daily monitoring read.
// Definitions match worker/scripts/stats.mjs:
//   - a play is "completed" when it reached an accusation, a rating or the full reveal (the same
//     three triggers as the permanent Gate 2 counter in totals; Gate 2: 500 by strangers);
//   - testers are plays made with the access key; everything else is a stranger;
//   - the assistant comes from plays.client, the MCP client's User-Agent.
// Play rows are deleted after 90 days (src/retention.ts), so "retained" means the last 90 days.
// Page views and MCP outcomes come from daily_counts (src/usage.ts); they are null until that
// table's migration is applied, so the rest still loads.

const DAY = 86_400_000;

export function assistantOf(ua: string | null | undefined): string {
  const s = ua ?? "";
  return /openai|chatgpt/i.test(s) ? "ChatGPT" : /claude|anthropic/i.test(s) ? "Claude"
    : /gemini|google/i.test(s) ? "Gemini" : /mistral|vibe|le ?chat/i.test(s) ? "Vibe"
    : /perplexity/i.test(s) ? "Perplexity" : "Other";
}

const COMPLETED = `(EXISTS (SELECT 1 FROM play_events e WHERE e.play_id = p.id AND e.kind IN ('accusation', 'reveal', 'ending'))
                  OR EXISTS (SELECT 1 FROM ratings r WHERE r.play_id = p.id))`;
const SOLVED = `EXISTS (SELECT 1 FROM play_events e WHERE e.play_id = p.id AND e.verdict = 'correct')`;
const ACCUSED = `EXISTS (SELECT 1 FROM play_events e WHERE e.play_id = p.id AND e.kind = 'accusation')`;

type Row = Record<string, any>;
const num = (v: unknown) => Number(v) || 0;
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

export async function adminStats(db: D1Database, env: { ENVIRONMENT?: string }, daysParam: string | null, now = Date.now()) {
  const d = Number(daysParam ?? 30);
  const days = Number.isInteger(d) && d >= 1 && d <= 400 ? d : 30;
  const since = now - days * DAY;
  const week = now - 7 * DAY;
  const sinceDay = new Date(now - (days - 1) * DAY).toISOString().slice(0, 10);
  const all = async (sql: string, ...args: unknown[]) => ((await db.prepare(sql).bind(...args).all<Row>()).results ?? []);

  const [who, stories, clients, daily, accusations, solveRows, ratingsByStory, ratingsWindow, ratingTexts, subs, attempts] = await Promise.all([
    all(`SELECT p.tester AS tester, count(*) AS plays,
                sum(CASE WHEN ${COMPLETED} THEN 1 ELSE 0 END) AS completed,
                sum(CASE WHEN ${SOLVED} THEN 1 ELSE 0 END) AS solved,
                sum(CASE WHEN p.started_at >= ? THEN 1 ELSE 0 END) AS in_window,
                sum(CASE WHEN p.started_at >= ? AND ${COMPLETED} THEN 1 ELSE 0 END) AS completed_in_window,
                sum(CASE WHEN p.started_at >= ? THEN 1 ELSE 0 END) AS week
         FROM plays p GROUP BY p.tester`, since, since, week),
    all(`SELECT p.story AS story, count(*) AS plays,
                sum(CASE WHEN ${COMPLETED} THEN 1 ELSE 0 END) AS completed,
                sum(CASE WHEN ${SOLVED} THEN 1 ELSE 0 END) AS solved
         FROM plays p WHERE p.tester = 0 AND p.started_at >= ? GROUP BY p.story ORDER BY plays DESC`, since),
    all(`SELECT coalesce(p.client, '') AS client, p.tester AS tester, count(*) AS plays,
                sum(CASE WHEN p.started_at >= ? THEN 1 ELSE 0 END) AS in_window,
                sum(CASE WHEN p.started_at >= ? THEN 1 ELSE 0 END) AS week,
                sum(CASE WHEN ${COMPLETED} THEN 1 ELSE 0 END) AS completed
         FROM plays p GROUP BY p.client, p.tester`, since, week),
    all(`SELECT date(started_at / 1000, 'unixepoch') AS day,
                sum(CASE WHEN tester = 0 THEN 1 ELSE 0 END) AS strangers,
                sum(CASE WHEN tester = 1 THEN 1 ELSE 0 END) AS testers
         FROM plays WHERE started_at >= ? GROUP BY day ORDER BY day`, since),
    // Passenger-page accusations carry no play id, so they can't be told apart from testers; they
    // count as strangers. Connector accusations take their play's tester flag.
    all(`SELECT coalesce(e.app, 'connector') AS app, coalesce(p.tester, 0) AS tester, count(*) AS n,
                sum(CASE WHEN e.verdict = 'correct' THEN 1 ELSE 0 END) AS correct
         FROM play_events e LEFT JOIN plays p ON p.id = e.play_id
         WHERE e.kind = 'accusation' AND e.at >= ? GROUP BY app, tester`, since),
    all(`SELECT sum(CASE WHEN ${ACCUSED} THEN 1 ELSE 0 END) AS accused, sum(CASE WHEN ${SOLVED} THEN 1 ELSE 0 END) AS solved
         FROM plays p WHERE p.tester = 0 AND p.started_at >= ?`, since),
    // Ratings outlive their play rows (kept; the comment is cleared at 90 days), so an old rating
    // whose play is gone counts as a stranger's.
    all(`SELECT r.story AS story, count(*) AS n, round(avg(r.stars), 2) AS avg_stars, sum(coalesce(r.spoiled, 0)) AS spoiled
         FROM ratings r LEFT JOIN plays p ON p.id = r.play_id WHERE coalesce(p.tester, 0) = 0 AND coalesce(r.tester, 0) = 0 GROUP BY r.story ORDER BY n DESC`),
    all(`SELECT count(*) AS n, round(avg(r.stars), 2) AS avg_stars, sum(coalesce(r.spoiled, 0)) AS spoiled,
                sum(CASE WHEN r.comment IS NOT NULL AND r.comment <> '' THEN 1 ELSE 0 END) AS comments,
                sum(CASE WHEN r.feedback IS NOT NULL AND r.feedback <> '' THEN 1 ELSE 0 END) AS feedback
         FROM ratings r LEFT JOIN plays p ON p.id = r.play_id WHERE coalesce(p.tester, 0) = 0 AND coalesce(r.tester, 0) = 0 AND r.at >= ?`, since),
    // The newest comments and feedback in the window, in the players' words (cleared at 90 days by
    // retention), so the owner reads them from the dashboard without opening the database.
    all(`SELECT r.story AS story, r.stars AS stars, r.spoiled AS spoiled, r.comment AS comment, r.feedback AS feedback, r.at AS at, coalesce(r.tester, p.tester, 0) AS tester
         FROM ratings r LEFT JOIN plays p ON p.id = r.play_id
         WHERE r.at >= ? AND ((r.comment IS NOT NULL AND r.comment <> '') OR (r.feedback IS NOT NULL AND r.feedback <> ''))
         ORDER BY r.at DESC LIMIT 50`, since),
    // Smoke-test rows (dev_marker = 1) are left out.
    all(`SELECT status, count(*) AS n, min(created_at) AS oldest, sum(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS in_window
         FROM submissions WHERE dev_marker = 0 GROUP BY status`, since),
    all(`SELECT outcome, count(*) AS n FROM submission_attempts WHERE at >= ? GROUP BY outcome`, now - DAY),
  ]);

  const side = (tester: number) => who.find((r) => num(r.tester) === tester) ?? {};
  const strangers = side(0), testers = side(1);
  const playsOf = (r: Row) => ({
    retained: num(r.plays), completed: num(r.completed), solved: num(r.solved),
    inWindow: num(r.in_window), completedInWindow: num(r.completed_in_window), last7Days: num(r.week),
  });

  const assistants: Record<string, { strangers: number; strangersInWindow: number; strangersLast7Days: number; strangersCompleted: number; testers: number }> = {};
  for (const r of clients) {
    const a = (assistants[assistantOf(r.client)] ??= { strangers: 0, strangersInWindow: 0, strangersLast7Days: 0, strangersCompleted: 0, testers: 0 });
    if (num(r.tester)) a.testers += num(r.plays);
    else { a.strangers += num(r.plays); a.strangersInWindow += num(r.in_window); a.strangersLast7Days += num(r.week); a.strangersCompleted += num(r.completed); }
  }

  const strangerAcc = accusations.filter((r) => !num(r.tester));
  const accTotal = strangerAcc.reduce((s, r) => s + num(r.n), 0);
  const accCorrect = strangerAcc.reduce((s, r) => s + num(r.correct), 0);
  const playsAccused = num(solveRows[0]?.accused), playsSolved = num(solveRows[0]?.solved);

  const subsBy = Object.fromEntries(["pending", "approved", "rejected"].map((s) => {
    const r = subs.find((x) => x.status === s);
    return [s, num(r?.n)];
  }));
  const oldestPending = subs.find((x) => x.status === "pending")?.oldest ?? null;
  // Gate 2 is all-time: the permanent counter (migrations/0005_totals.sql), never below what the
  // 90-day play log shows. Falls back to the log alone if the table isn't there yet.
  let allTimeCompleted: number | null = null;
  try {
    const row = await db.prepare("SELECT n FROM totals WHERE key = 'completed_stranger_plays'").first<{ n: number }>();
    allTimeCompleted = row ? num(row.n) : 0;
  } catch { /* table missing: use the play log */ }

  return {
    generatedAt: new Date(now).toISOString(),
    environment: env.ENVIRONMENT ?? null,
    days,
    since: new Date(since).toISOString(),
    retentionNote: "Play rows are kept 90 days, so retained counts cover the last 90 days at most.",
    gate2: {
      completedStrangerPlays: Math.max(allTimeCompleted ?? 0, num(strangers.completed)),
      target: 500,
      basis: allTimeCompleted === null ? "last 90 days (permanent counter missing)" : "all time",
    },
    plays: { strangers: playsOf(strangers), testers: playsOf(testers) },
    daily: daily.map((r) => ({ day: r.day, strangers: num(r.strangers), testers: num(r.testers) })),
    stories: stories.map((r) => ({ story: r.story, plays: num(r.plays), completed: num(r.completed), solved: num(r.solved) })),
    assistants: Object.entries(assistants).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.strangers - a.strangers || b.testers - a.testers),
    accusations: {
      total: accTotal,
      correct: accCorrect,
      correctPct: pct(accCorrect, accTotal),
      byApp: strangerAcc.map((r) => ({ app: r.app, n: num(r.n), correct: num(r.correct) })),
      testerTotal: accusations.filter((r) => num(r.tester)).reduce((s, r) => s + num(r.n), 0),
      // Of strangers' connector plays in the window that reached an accusation, how many were solved.
      playsAccused,
      playsSolved,
      solveRatePct: pct(playsSolved, playsAccused),
    },
    ratings: {
      inWindow: { n: num(ratingsWindow[0]?.n), avgStars: ratingsWindow[0]?.avg_stars ?? null, spoiled: num(ratingsWindow[0]?.spoiled), comments: num(ratingsWindow[0]?.comments), feedback: num(ratingsWindow[0]?.feedback) },
      byStory: ratingsByStory.map((r) => ({ story: r.story, n: num(r.n), avgStars: r.avg_stars, spoiled: num(r.spoiled) })),
      // In the players' words; tester rows (ours) are marked so they can be skipped.
      texts: ratingTexts.map((r) => ({ story: r.story, stars: num(r.stars), spoiled: r.spoiled === null ? null : Boolean(r.spoiled), comment: r.comment ?? null, feedback: r.feedback ?? null, at: new Date(num(r.at)).toISOString(), tester: Boolean(num(r.tester)) })),
    },
    // Verdicts from players on stories still being tested (migration 0011): passes and needs-work by
    // story, and the newest suggestions in their words. Empty if the table isn't there yet.
    testVerdicts: await (async () => {
      try {
        const by = (await db.prepare("SELECT story, sum(CASE WHEN verdict = 'passed' THEN 1 ELSE 0 END) AS passed, sum(CASE WHEN verdict = 'needs_work' THEN 1 ELSE 0 END) AS needs_work, sum(tester) AS by_testers FROM test_verdicts GROUP BY story ORDER BY story").all<Row>()).results ?? [];
        const texts = (await db.prepare("SELECT story, verdict, feedback, at, tester FROM test_verdicts WHERE at >= ? AND feedback IS NOT NULL AND feedback <> '' ORDER BY at DESC LIMIT 50").bind(since).all<Row>()).results ?? [];
        return {
          byStory: by.map((r) => ({ story: r.story, passed: num(r.passed), needsWork: num(r.needs_work), byTesters: num(r.by_testers) })),
          texts: texts.map((r) => ({ story: r.story, verdict: r.verdict, feedback: r.feedback, at: new Date(num(r.at)).toISOString(), tester: Boolean(num(r.tester)) })),
        };
      } catch { return { byStory: [], texts: [] }; }
    })(),
    // Challenges the three judges upheld (a right answer the board refused): story, "category|value|votes|what the
    // player said". These are the alternative names and spellings to add to a clue's Also accept.
    upheldChallenges: await (async () => {
      try { return ((await db.prepare("SELECT story, detail, at FROM play_events WHERE kind = 'challenge' AND verdict = 'upheld' ORDER BY at DESC LIMIT 50").all<Row>()).results ?? []).map((r) => ({ story: r.story, detail: r.detail, at: new Date(num(r.at)).toISOString() })); }
      catch { return []; }
    })(),
    // Real difficulty (migration 0022): clues asked at least five times, hardest and easiest by share right.
    clueDifficulty: await (async () => {
      try {
        const rows = ((await db.prepare("SELECT story, clue_id, asked, right FROM clue_stats WHERE asked >= 5").all<Row>()).results ?? []).map((r) => ({ story: r.story, clue: r.clue_id, asked: num(r.asked), right: num(r.right), share: num(r.right) / Math.max(1, num(r.asked)) }));
        rows.sort((a, b) => a.share - b.share);
        return { counted: rows.length, hardest: rows.slice(0, 20), easiest: rows.slice(-20).reverse() };
      } catch { return { counted: 0, hardest: [], easiest: [] }; }
    })(),
    // "Did it connect?" answers (migration 0018): yes/no per assistant, and the latest problems reported.
    connectFeedback: await (async () => {
      try {
        const totals = ((await db.prepare("SELECT assistant, outcome, count(*) AS n FROM connect_feedback GROUP BY assistant, outcome").all<Row>()).results ?? []).map((r) => ({ assistant: r.assistant, outcome: r.outcome, n: num(r.n) }));
        const problems = ((await db.prepare("SELECT assistant, issue, note, page, at FROM connect_feedback WHERE outcome = 'no' ORDER BY at DESC LIMIT 50").all<Row>()).results ?? []).map((r) => ({ assistant: r.assistant, issue: r.issue, note: r.note, page: r.page, at: new Date(num(r.at)).toISOString() }));
        return { totals, problems };
      } catch { return { totals: [], problems: [] }; }
    })(),
    // GitHub (migration 0016): totals per kind, and who is new since the first (baseline) run.
    github: await (async () => {
      try {
        const totals = ((await db.prepare("SELECT kind, count(*) AS n FROM github_seen GROUP BY kind").all<Row>()).results ?? []).map((r) => [String(r.kind), num(r.n)]);
        const fresh = ((await db.prepare("SELECT kind, login, first_at FROM github_seen WHERE baseline = 0 ORDER BY first_at DESC LIMIT 50").all<Row>()).results ?? []).map((r) => ({ kind: r.kind, login: r.login, at: new Date(num(r.first_at)).toISOString() }));
        const days = ((await db.prepare("SELECT day, followers, stars, watchers, forks FROM github_counts ORDER BY day DESC LIMIT 30").all<Row>()).results ?? []).map((r) => ({ day: r.day, followers: num(r.followers), stars: num(r.stars), watchers: num(r.watchers), forks: num(r.forks) }));
        return { totals: Object.fromEntries(totals), newSinceBaseline: fresh, dailyCounts: days };
      } catch { return { totals: {}, newSinceBaseline: [], dailyCounts: [] }; }
    })(),
    // Names upheld challenges taught the boards (migration 0014): fold the good ones into secrets.md
    // with tools/check-story/add-aliases.mjs; clue_id is "category|answer".
    learnedAliases: await (async () => {
      try { return ((await db.prepare("SELECT story, clue_id, alias, at FROM clue_aliases ORDER BY at DESC LIMIT 100").all<Row>()).results ?? []).map((r) => ({ story: r.story, clue: r.clue_id, alias: r.alias, at: new Date(num(r.at)).toISOString() })); }
      catch { return []; }
    })(),
    // Teams players asked for that Team Trivia doesn't cover (request_team), most asked first.
    teamRequests: await (async () => {
      try { return ((await db.prepare("SELECT detail AS team, count(*) AS n, max(at) AS last FROM play_events WHERE kind = 'team_request' GROUP BY detail ORDER BY n DESC, last DESC LIMIT 50").all<Row>()).results ?? []).map((r) => ({ team: r.team, n: num(r.n), last: new Date(num(r.last)).toISOString() })); }
      catch { return []; }
    })(),
    submissions: {
      ...subsBy,
      newInWindow: subs.reduce((s, r) => s + num(r.in_window), 0),
      oldestPendingAt: oldestPending ? new Date(num(oldestPending)).toISOString() : null,
      attempts24h: Object.fromEntries(attempts.map((r) => [r.outcome, num(r.n)])),
    },
    ...(await countsSection(db, sinceDay)),
  };
}

async function countsSection(db: D1Database, sinceDay: string) {
  let rows: Row[];
  try {
    rows = (await db.prepare("SELECT day, kind, key, n FROM daily_counts WHERE day >= ? ORDER BY day").bind(sinceDay).all<Row>()).results ?? [];
  } catch {
    return { pageViews: null, mcp: null, jobs: null, countsNote: "daily_counts is missing: apply migration 0004_daily_counts.sql" };
  }
  const sum = (pred: (r: Row) => boolean) => rows.filter(pred).reduce((s, r) => s + num(r.n), 0);
  const group = (pred: (r: Row) => boolean, keyOf: (r: Row) => string) => {
    const out: Record<string, number> = {};
    for (const r of rows.filter(pred)) out[keyOf(r)] = (out[keyOf(r)] ?? 0) + num(r.n);
    return Object.entries(out).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
  };
  const isError = (k: string) => /^(error:|rpc_error:|http_|exception$)/.test(k);
  const mcpFor = (kind: string) => ({
    requests: sum((r) => r.kind === kind && r.key === "requests"),
    toolCalls: sum((r) => r.kind === kind && r.key.startsWith("call:")),
    errors: sum((r) => r.kind === kind && isError(r.key)),
    rejected: sum((r) => r.kind === kind && r.key === "rejected"),
    calls: group((r) => r.kind === kind && r.key.startsWith("call:"), (r) => r.key.slice(5)),
    errorsByKind: group((r) => r.kind === kind && isError(r.key), (r) => r.key),
    daily: group((r) => r.kind === kind && r.key === "requests", (r) => r.day).map((x) => ({ day: x.key, requests: x.n,
      errors: sum((r) => r.kind === kind && r.day === x.key && isError(r.key)) })).sort((a, b) => a.day.localeCompare(b.day)),
  });
  const jobDays = rows.filter((r) => r.kind === "job").map((r) => ({ day: r.day, key: r.key }));
  return {
    pageViews: {
      total: sum((r) => r.kind === "page"),
      crawlers: sum((r) => r.kind === "crawler"),
      daily: group((r) => r.kind === "page", (r) => r.day).map((x) => ({ day: x.key, n: x.n })).sort((a, b) => a.day.localeCompare(b.day)),
      byPage: group((r) => r.kind === "page", (r) => r.key),
      byStory: group((r) => r.kind === "story_page", (r) => r.key),
    },
    mcp: { strangers: mcpFor("mcp"), testers: mcpFor("mcp_tester") },
    jobs: {
      lastRetentionDay: jobDays.filter((j) => j.key === "retention").map((j) => j.day).sort().at(-1) ?? null,
      lastRetentionErrorDay: jobDays.filter((j) => j.key === "retention_error").map((j) => j.day).sort().at(-1) ?? null,
    },
  };
}
