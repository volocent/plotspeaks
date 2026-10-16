// Play statistics from the D1 database: what Gate 2 measures.
// Usage (from worker/): node scripts/stats.mjs [--env=dev] [--local]
// A "completed" play reached a verdict (any accusation) or a rating. Gate 2 counts strangers
// only, so tester plays (made with the access key) are reported separately.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const env = (process.argv.find((a) => a.startsWith('--env=')) || '--env=dev').slice(6);
const where = process.argv.includes('--local') ? '--local' : '--remote';

function q(sql) {
  // Run the local wrangler through node directly (no shell), so the SQL reaches it as one argument.
  const wrangler = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
  const r = spawnSync(process.execPath, [fileURLToPath(wrangler), 'd1', 'execute', env === 'prod' ? 'plotspeaks' : `plotspeaks-${env}`, `--env=${env}`, where, '--json',
    `--command=${sql.replace(/\s+/g, ' ').trim()}`], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
  const out = r.stdout || '';
  // The JSON result starts with "[{"; a wrangler banner line such as "[WARNING]" must not be mistaken for it.
  const start = out.indexOf('[{');
  if (r.status !== 0 || start < 0) throw new Error(`d1 query failed: ${(r.stderr || out).slice(0, 400)}`);
  return JSON.parse(out.slice(start))[0].results;
}

// Same definition as src/stats.ts: an accusation, a reveal or a rating completes a play.
const COMPLETED = `(EXISTS (SELECT 1 FROM play_events e WHERE e.play_id = p.id AND e.kind IN ('accusation', 'reveal'))
                  OR EXISTS (SELECT 1 FROM ratings r WHERE r.play_id = p.id))`;

const byGroup = q(`
  SELECT p.tester, p.story,
         count(*) AS plays,
         sum(CASE WHEN ${COMPLETED} THEN 1 ELSE 0 END) AS completed,
         sum(CASE WHEN EXISTS (SELECT 1 FROM play_events e WHERE e.play_id = p.id AND e.verdict = 'correct') THEN 1 ELSE 0 END) AS solved
  FROM plays p GROUP BY p.tester, p.story ORDER BY p.tester, p.story`);
const ratings = q(`SELECT story, count(*) AS n, round(avg(stars), 2) AS avg_stars, sum(spoiled) AS said_spoiled FROM ratings GROUP BY story`);
const clients = q(`SELECT tester, coalesce(client, '(unknown)') AS client, count(*) AS plays FROM plays GROUP BY tester, client ORDER BY plays DESC LIMIT 10`);

const line = (cols) => cols.map((c, i) => String(c ?? '').padEnd(i === 0 ? 12 : 22)).join('');
console.log(`Plot Speaks plays (${env}, ${where.slice(2)})\n`);
console.log(line(['who', 'story', 'plays', 'completed', 'solved']));
for (const r of byGroup) console.log(line([r.tester ? 'testers' : 'strangers', r.story, r.plays, r.completed, r.solved]));
const strangers = byGroup.filter((r) => !r.tester).reduce((a, r) => a + r.completed, 0);
// All-time count from the permanent counter (play rows are deleted after 90 days).
let allTime = null;
try { allTime = q(`SELECT n FROM totals WHERE key = 'completed_stranger_plays'`)[0]?.n ?? 0; } catch { /* no table yet */ }
console.log(`\nGate 2: ${Math.max(allTime ?? 0, strangers)} of 500 completed plays by strangers (${allTime === null ? 'last 90 days only' : 'all time'}).`);
console.log('\nRatings');
for (const r of ratings) console.log(`  ${r.story}: ${r.n} rating(s), average ${r.avg_stars} stars, ${r.said_spoiled ?? 0} said something was given away early`);
// Which assistant each play came from, from the MCP client's User-Agent.
const assistant = (ua) => /openai|chatgpt/i.test(ua) ? 'ChatGPT' : /claude|anthropic/i.test(ua) ? 'Claude'
  : /gemini|google/i.test(ua) ? 'Gemini' : /mistral|vibe|le ?chat/i.test(ua) ? 'Vibe' : /perplexity/i.test(ua) ? 'Perplexity' : 'Other';
const totals = {};
const weekAgo = Date.now() - 7 * 86400 * 1000;
for (const r of q(`SELECT coalesce(client, '') AS client, count(*) AS plays, sum(CASE WHEN started_at > ${weekAgo} THEN 1 ELSE 0 END) AS week FROM plays WHERE tester = 0 GROUP BY client`)) {
  const a = assistant(r.client);
  totals[a] ??= { plays: 0, week: 0 };
  totals[a].plays += r.plays; totals[a].week += r.week;
}
console.log('\nStranger plays by assistant (all time / last 7 days)');
const ranked = Object.entries(totals).sort((x, y) => y[1].plays - x[1].plays);
if (!ranked.length) console.log('  none yet');
for (const [a, v] of ranked) console.log(`  ${a}: ${v.plays} / ${v.week}`);
console.log('\nAssistants (by user agent)');
for (const r of clients) console.log(`  ${r.tester ? 'tester  ' : 'stranger'}  ${r.client}: ${r.plays}`);
