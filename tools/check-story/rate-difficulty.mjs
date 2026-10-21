#!/usr/bin/env node
// Blind difficulty for a trivia board (plan 2026-10-19, item 15). Three blind answerers (Claude Haiku,
// each with a different short persona, no answer key, no tools) answer every clue; a clue's difficulty
// is how many of the three got it (3 = easy, 0 = hard), graded with the server's own answerMatches.
// The deal then prefers easy clues at 100-200 and hard ones at 400-500 (worker/src/games.ts).
//
//   node tools/check-story/rate-difficulty.mjs <slug> [<slug> ...]
//
// Writes stories/<slug>/difficulty.json (gitignored: its keys are clue ids, which contain answers) and
// prints per-category averages so an unbalanced board shows. Needs the Claude CLI signed in; runs the
// answerers one after another (parallel CLI runs have corrupted its config before).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrivia, answerMatches } from './trivia.mjs';
import { findClaudeBin } from '../playtest/claude.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PERSONAS = [
  'You are a quick quiz contestant who answers on instinct.',
  'You are a careful quiz contestant who thinks before answering.',
  'You are a casual player on a long drive, answering from everyday knowledge.',
];
const CHUNK = 60;
const clueId = (cat, q) => `${cat.toLowerCase()}|${q.answer.toLowerCase().trim()}`;

function ask(persona, rows) {
  const prompt = `Answer each trivia clue with your best short answer (a name, a word or a number). If unsure, guess. Reply with ONLY a JSON object mapping each id to your answer.\n\n${rows.map((r) => `${JSON.stringify(r.id)}: ${r.clue}`).join('\n')}`;
  const r = spawnSync(findClaudeBin(), ['-p', '--model', 'haiku', '--output-format', 'json', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--system-prompt', `${persona} Output only JSON.`], { input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: process.env.TEMP || process.cwd(), timeout: 600000 });
  try { return JSON.parse(JSON.parse(r.stdout).result.replace(/^```(?:json)?|```$/gm, '').trim()); } catch { return {}; }
}

for (const slug of process.argv.slice(2)) {
  const file = join(ROOT, 'stories', slug, 'secrets.md');
  if (!existsSync(file)) { console.error(`${slug}: no secrets.md`); continue; }
  const cats = parseTrivia(readFileSync(file, 'utf8')).categories;
  const rows = cats.flatMap((c) => c.clues.map((q, i) => ({ id: `${c.name}|${q.value}|${i}`, cat: c, q, clue: q.steps[0] })));
  const hits = new Map(rows.map((r) => [r.id, 0]));
  for (const persona of PERSONAS) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const got = ask(persona, part);
      for (const r of part) if (r.cat.estimate ? false : answerMatches(String(got[r.id] ?? ''), r.q)) hits.set(r.id, hits.get(r.id) + 1);
    }
  }
  const out = {};
  for (const r of rows) out[clueId(r.cat.name, r.q)] = hits.get(r.id);
  writeFileSync(join(ROOT, 'stories', slug, 'difficulty.json'), JSON.stringify(out, null, 1) + '\n');
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const board = mean(rows.filter((r) => !r.cat.final).map((r) => hits.get(r.id)));
  console.log(`${slug}: ${rows.length} clues, board mean ${board.toFixed(2)} of 3`);
  for (const c of cats.filter((x) => !x.final && !x.estimate)) {
    const m = mean(rows.filter((r) => r.cat === c).map((r) => hits.get(r.id)));
    const byValue = [100, 200, 300, 400, 500].map((v) => mean(rows.filter((r) => r.cat === c && r.q.value === v).map((r) => hits.get(r.id))).toFixed(1)).join(' ');
    console.log(`  ${c.name}: ${m.toFixed(2)}${Math.abs(m - board) > 0.8 ? '  <- unbalanced' : ''}   by value: ${byValue}`);
  }
}
