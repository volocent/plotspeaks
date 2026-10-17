#!/usr/bin/env node
// Trivia verification pipeline (docs/FORMAT.md "Trivia": three blind answerers must agree with the
// key; a blind player sets the difficulty labels).
//
//   node tools/check-story/trivia-verify.mjs clues <story dir> <out.json>
//       writes the board's clues WITHOUT answers, for an answerer agent: [{id, category, value, clue}]
//       (a stepped clue is given whole, all steps, so the answerer has the most it could ever get)
//   node tools/check-story/trivia-verify.mjs grade <story dir> <answers.json> [<answers.json> ...]
//       each answers file is {"<id>": "answer", ...}; prints per clue how many answerers matched
//       the key (using the server's own matching), and lists every clue that not all of them got
//
// The clue file carries no answers; the grade output does (it is for the author).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseTrivia, answerMatches } from './trivia.mjs';

const [cmd, dir, ...files] = process.argv.slice(2);
if (!cmd || !dir) { console.error('usage: trivia-verify.mjs clues <dir> <out.json> | grade <dir> <answers.json>...'); process.exit(2); }
const secrets = join(resolve(dir), 'secrets.md');
if (!existsSync(secrets)) { console.error(`no secrets.md in ${dir}`); process.exit(2); }
const { categories } = parseTrivia(readFileSync(secrets, 'utf8'));
const clues = categories.flatMap((c) => c.clues.map((q) => ({ id: `${c.final ? 'final' : c.name}|${q.value}`.toLowerCase(), category: c.final ? `Final: ${c.name}` : c.name, value: q.value, q })));

if (cmd === 'clues') {
  writeFileSync(files[0], JSON.stringify(clues.map(({ id, category, value, q }) => ({ id, category, value, clue: q.steps.join(' / ') })), null, 2));
  console.log(`wrote ${clues.length} clues (no answers) to ${files[0]}`);
} else if (cmd === 'grade') {
  const sets = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const doubtful = [];
  for (const { id, q } of clues) {
    const got = sets.map((s) => s[id] ?? '');
    const hits = got.filter((a) => answerMatches(a, q)).length;
    if (hits < sets.length) doubtful.push({ id, key: q.answer, hits, answers: got });
  }
  console.log(`${clues.length - doubtful.length} of ${clues.length} clues: every answerer matched the key.`);
  for (const d of doubtful) console.log(`${d.hits}/${sets.length}  ${d.id}  key "${d.key}"  answers: ${d.answers.map((a) => JSON.stringify(a)).join(', ')}`);
} else { console.error(`unknown command ${cmd}`); process.exit(2); }
