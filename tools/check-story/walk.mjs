#!/usr/bin/env node
// Walks a choose-your-path story (kind: branching) the way the server will serve it.
//
//   node tools/check-story/walk.mjs stories/<slug>                  every ending and the shortest choice path to it
//   node tools/check-story/walk.mjs stories/<slug> --play 2 1 3     plays from start, picking choice 2, then 1, then 3,
//                                                                   printing each node exactly as the narrator gets it
//   node tools/check-story/walk.mjs stories/<slug> --all            every node with its choices (for a reviewer)
//
// Reads secrets.md, so its output contains the hidden story: for authors and reviewers only.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBranches, offered } from './branches.mjs';

const [dirArg, ...rest] = process.argv.slice(2);
if (!dirArg) { console.error('usage: node tools/check-story/walk.mjs stories/<slug> [--play N N ...] [--all]'); process.exit(2); }
const file = join(resolve(dirArg), 'secrets.md');
if (!existsSync(file)) { console.error(`no secrets.md in ${dirArg}`); process.exit(2); }
const g = parseBranches(readFileSync(file, 'utf8'));
if (!g.nodes.start) { console.error('no "## Node start"'); process.exit(1); }

const show = (node, flags) => {
  const open = offered(node, flags);
  const lines = [`[${node.id}] flags: ${flags.join(', ') || '-'}`, `READ ALOUD: ${node.read_aloud}`];
  if (node.notes) lines.push(`NOTES: ${node.notes}`);
  if (node.ending) lines.push(`ENDING: ${node.ending.name}${node.ending.tone ? ` (${node.ending.tone})` : ''}`);
  else open.forEach((c, i) => lines.push(`  ${i + 1}. ${c.answer ? `(puzzle answer, not shown to the player) ${c.answer.join(' / ')}` : c.text}`));
  return lines.join('\n');
};

if (rest[0] === '--all') {
  for (const id of g.order) {
    const n = g.nodes[id];
    console.log(`\n## ${id}${n.sets.length ? `  sets: ${n.sets.join(', ')}` : ''}\n${n.read_aloud}`);
    if (n.ending) console.log(`ENDING: ${n.ending.name}`);
    for (const c of n.choices) console.log(`  - ${c.text} -> ${c.to}${c.if.length ? ` [if ${c.if.join(', ')}]` : ''}${c.unless.length ? ` [unless ${c.unless.join(', ')}]` : ''}`);
  }
} else if (rest[0] === '--play') {
  let node = g.nodes.start;
  let flags = [...new Set(node.sets)];
  console.log(show(node, flags));
  for (const pick of rest.slice(1).map(Number)) {
    const c = offered(node, flags)[pick - 1];
    if (!c) { console.log(`\n(choice ${pick} is not offered here)`); break; }
    node = g.nodes[c.to];
    flags = [...new Set([...flags, ...node.sets])].sort();
    console.log(`\n> ${c.text}\n${show(node, flags)}`);
    if (node.ending) break;
  }
} else {
  // Breadth-first over (node, flags): the shortest choice path to each ending.
  const seen = new Set();
  const found = new Map();
  const queue = [{ id: 'start', flags: [...new Set(g.nodes.start.sets)].sort(), path: [] }];
  while (queue.length && seen.size < 20000) {
    const s = queue.shift();
    const key = `${s.id}|${s.flags.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = g.nodes[s.id];
    if (n.ending) { if (!found.has(s.id)) found.set(s.id, s.path); continue; }
    offered(n, s.flags).forEach((c, i) => {
      const next = g.nodes[c.to];
      if (next) queue.push({ id: c.to, flags: [...new Set([...s.flags, ...next.sets])].sort(), path: [...s.path, i + 1] });
    });
  }
  for (const [id, path] of found) console.log(`${g.nodes[id].ending.name} [${id}]: ${path.length} choices; --play ${path.join(' ')}`);
  const missing = g.order.filter((id) => g.nodes[id].ending && !found.has(id));
  if (missing.length) console.log(`unreachable endings: ${missing.join(', ')}`);
}
