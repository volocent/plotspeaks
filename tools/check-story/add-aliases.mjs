// Merges alternative place names (aliases.mjs) into the answer columns of the trivia boards.
//   node tools/check-story/add-aliases.mjs          dry run: lists what would change
//   node tools/check-story/add-aliases.mjs --write  edits stories/*/secrets.md
// A row whose answer is any name in a group gets the group's PREFERRED name as its answer and the other
// names (and its old answer, if different) in "Also accept". Rows that already have a name keep it.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { normAnswer } from './trivia.mjs';
import { NAME_GROUPS } from './aliases.mjs';

const write = process.argv.includes('--write');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const groupOf = new Map();
for (const g of NAME_GROUPS) for (const n of g) { const k = normAnswer(n); if (!groupOf.has(k)) groupOf.set(k, g); }

let changed = 0;
for (const d of readdirSync('stories')) {
  if (only.length && !only.includes(d)) continue;
  const story = `stories/${d}/story.md`, sp = `stories/${d}/secrets.md`;
  if (!existsSync(story) || !existsSync(sp) || !/^\s*kind:\s*trivia\b/m.test(readFileSync(story, 'utf8'))) continue;
  const raw = readFileSync(sp, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let n = 0;
  const out = raw.split(/\r?\n/).map((line) => {
    if (!/^\|\s*\d+\s*\|/.test(line)) return line;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) return line;
    const [value, clue, answer, also = '', asOf = ''] = cells;
    const g = groupOf.get(normAnswer(answer));
    if (!g) return line;
    const have = new Set(also.split(';').map((s) => normAnswer(s)).filter(Boolean));
    const alts = [...g, answer].filter((x) => normAnswer(x) !== normAnswer(g[0]));
    const merged = [...also.split(';').map((s) => s.trim()).filter(Boolean)];
    for (const a of alts) if (!have.has(normAnswer(a)) && !merged.some((m) => normAnswer(m) === normAnswer(a))) merged.push(a);
    if (g[0] === answer && merged.join('; ') === also) return line;
    n++;
    return `| ${value} | ${clue} | ${g[0]} | ${merged.join('; ')} | ${asOf} |`;
  });
  if (n) { changed += n; console.log(`${d}: ${n} rows`); if (write) writeFileSync(sp, out.join(eol)); }
}
console.log(`${changed} rows ${write ? 'updated' : 'would change (dry run; --write to apply)'}`);
