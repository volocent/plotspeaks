// Choose-your-path stories (kind: branching). Parser and checks, shared by the lint, the worker-data
// build and the Worker (approved submissions). Pure functions on strings.
//
// Format (secrets.md; docs/FORMAT.md "Choose your path"):
//
//   ## Node start
//   **Read aloud:** What the narrator says on arriving here. May run over several paragraphs.
//   **Narrator notes:** Optional; how to play the node, never read aloud.
//   **Sets:** heard_radio, kept_key           (flags switched on when the player arrives)
//   **Choice:** Climb to the lamp room -> lamp
//   **Choice:** Answer the radio -> radio [if heard_radio]
//   **Choice:** Walk out into the storm -> storm [unless kept_key]
//
//   ## Node drowned
//   **Read aloud:** ...
//   **Ending:** The tide takes the light (bad)
//
// A node with **Ending:** has no choices. The first node is "start". A choice is offered only when
// every [if a, b] flag is on and no [unless c] flag is; flags never switch off.

const nl = (s) => String(s ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const words = (s) => (String(s).trim().match(/\S+/g) || []).length;
const flagList = (s) => String(s || '').split(/[,\s]+/).map((f) => f.trim().toLowerCase()).filter(Boolean);

/** Parses every "## Node <id>" section. Returns { nodes: {id: node}, order: [ids], lines: {id: line} }. */
export function parseBranches(secretsText) {
  const text = nl(secretsText);
  const lines = text.split('\n');
  const nodes = {};
  const order = [];
  const lineOf = {};
  let cur = null;
  let field = null;
  const finish = () => {
    if (!cur) return;
    cur.read_aloud = cur.read_aloud.trim();
    cur.notes = cur.notes.trim() || null;
  };
  lines.forEach((line, i) => {
    const h = /^##\s+Node\s+([A-Za-z0-9_-]+)\s*$/.exec(line);
    if (h) {
      finish();
      const id = h[1].toLowerCase();
      cur = { id, read_aloud: '', notes: '', sets: [], choices: [], ending: null };
      if (!nodes[id]) order.push(id);
      nodes[id] = cur;
      lineOf[id] = i + 1;
      field = null;
      return;
    }
    if (/^#{1,2}\s/.test(line)) { finish(); cur = null; field = null; return; }
    if (!cur) return;
    const f = /^\*\*(Read aloud|Narrator notes|Sets|Choice|Answer|Ending):\*\*\s*(.*)$/i.exec(line);
    if (f) {
      const key = f[1].toLowerCase();
      const val = f[2].trim();
      field = null;
      if (key === 'read aloud') { cur.read_aloud += val; field = 'read_aloud'; }
      else if (key === 'narrator notes') { cur.notes += val; field = 'notes'; }
      else if (key === 'sets') cur.sets.push(...flagList(val));
      else if (key === 'ending') {
        const m = /^(.*?)\s*(?:\((good|bad|strange|bittersweet)\))?$/i.exec(val);
        cur.ending = { name: (m?.[1] || val).trim(), tone: (m?.[2] || '').toLowerCase() || null };
      } else if (key === 'answer') {
        // A puzzle answer: never listed as a choice; taken when the player says one of the words.
        const m = /^(.*?)\s*->\s*([A-Za-z0-9_-]+)\s*$/.exec(val);
        if (m) cur.choices.push({ text: m[1].trim(), to: m[2].toLowerCase(), if: [], unless: [], line: i + 1, answer: m[1].split(/\s*;\s*/).map((a) => a.trim()).filter(Boolean) });
        else cur.choices.push({ text: val, to: null, if: [], unless: [], line: i + 1, bad: true });
      } else if (key === 'choice') {
        const m = /^(.*?)\s*->\s*([A-Za-z0-9_-]+)\s*(?:\[(if|unless)\s+([^\]]+)\])?\s*(?:\[(if|unless)\s+([^\]]+)\])?\s*$/i.exec(val);
        if (m) {
          const c = { text: m[1].trim(), to: m[2].toLowerCase(), if: [], unless: [], line: i + 1 };
          for (const [kw, fl] of [[m[3], m[4]], [m[5], m[6]]]) if (kw) c[kw.toLowerCase()].push(...flagList(fl));
          cur.choices.push(c);
        } else cur.choices.push({ text: val, to: null, if: [], unless: [], line: i + 1, bad: true });
      }
      return;
    }
    if (field && line.trim()) cur[field] += (cur[field] ? '\n\n' : '') + line.trim();
    else if (field && !line.trim() && cur[field]) { /* paragraph break: keep collecting */ }
  });
  finish();
  return { nodes, order, lines: lineOf };
}

/** The graph as the Worker serves it: per node its read-aloud, notes, flags set, choices and ending. */
export function compileBranches(secretsText) {
  const { nodes } = parseBranches(secretsText);
  if (!nodes.start) return null;
  const out = {};
  for (const [id, n] of Object.entries(nodes)) {
    out[id] = { read_aloud: n.read_aloud, notes: n.notes, sets: n.sets, ending: n.ending,
      choices: n.choices.filter((c) => c.to && nodes[c.to]).map((c) => ({ text: c.text, to: c.to, if: c.if, unless: c.unless, ...(c.answer ? { answer: c.answer } : {}) })) };
  }
  return { start: 'start', nodes: out };
}

/** The choices open to a player with these flags. */
export const offered = (node, flags) =>
  node.choices.filter((c) => c.to && c.if.every((f) => flags.includes(f)) && !c.unless.some((f) => flags.includes(f)));

/** Explores every (node, flags) state reachable from start. Capped, so a huge graph can't hang the lint. */
export function exploreBranches(graph, cap = 20000) {
  const { nodes } = graph;
  const seen = new Set();
  const reached = new Set();
  const endings = new Set();
  const deadEnds = [];
  if (!nodes.start) return { reached, endings, deadEnds, truncated: false };
  const queue = [{ id: 'start', flags: [] }];
  let truncated = false;
  while (queue.length) {
    if (seen.size >= cap) { truncated = true; break; }
    const { id, flags: before } = queue.shift();
    const node = nodes[id];
    if (!node) continue;
    const flags = [...new Set([...before, ...node.sets])].sort();
    const key = `${id}|${flags.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reached.add(id);
    if (node.ending) { endings.add(id); continue; }
    const open = offered(node, flags).filter((c) => nodes[c.to]);
    // A node that, with these flags, offers only puzzle answers shows the player no choices at all.
    if (!open.some((c) => !c.answer)) deadEnds.push({ id, flags });
    for (const c of open) queue.push({ id: c.to, flags });
  }
  return { reached, endings, deadEnds, truncated };
}

const err = (line, message) => ({ severity: 'ERROR', line, rule: 'branches', message, file: 'secrets.md' });
const warn = (line, message) => ({ severity: 'WARN', line, rule: 'branches', message, file: 'secrets.md' });

/** Rule `branches`: the graph is complete, every node reachable, every path ends, read-alouds fit a voice turn. */
export function checkBranches(secretsText) {
  const graph = parseBranches(secretsText);
  const { nodes, order, lines } = graph;
  const out = [];
  if (!order.length) return [err(1, 'a choose-your-path story needs "## Node <id>" sections in secrets.md, starting with "## Node start"')];
  if (!nodes.start) out.push(err(1, 'no "## Node start": the story must begin at a node called start'));
  for (const id of order) {
    const n = nodes[id];
    const at = lines[id];
    if (!n.read_aloud) out.push(err(at, `node ${id} has no "**Read aloud:**" text`));
    const w = words(n.read_aloud);
    if (w > 110) out.push(err(at, `node ${id}'s read-aloud is ${w} words; keep a node to about 80 (one spoken turn)`));
    else if (w > 80) out.push(warn(at, `node ${id}'s read-aloud is ${w} words; about 80 is one spoken turn`));
    for (const c of n.choices) {
      if (c.bad || !c.to) { out.push(err(c.line, `node ${id}: a choice must read "**Choice:** text -> node-id" (optionally [if flag] / [unless flag])`)); continue; }
      if (!nodes[c.to]) out.push(err(c.line, `node ${id}: choice "${c.text}" goes to node ${c.to}, which doesn't exist`));
      if (words(c.text) > 14) out.push(warn(c.line, `node ${id}: choice "${c.text}" is long; a spoken choice is a few words`));
    }
    if (n.ending && n.choices.length) out.push(err(at, `node ${id} is an ending but also has choices`));
    if (!n.ending && n.choices.length === 0) out.push(err(at, `node ${id} has no choices and no "**Ending:**"`));
    if (!n.ending && n.choices.length === 1) out.push(warn(at, `node ${id} has only one choice; a fork needs at least two`));
    if (!n.ending && n.choices.length && n.choices.every((c) => c.answer)) out.push(err(at, `node ${id} has only puzzle answers; give the player at least one spoken choice too (a hint, or giving up)`));
  }
  if (nodes.start) {
    const ex = exploreBranches(graph);
    for (const id of order) if (!ex.reached.has(id)) out.push(err(lines[id], `node ${id} can't be reached from start (check the choices and their [if]/[unless] flags)`));
    for (const d of ex.deadEnds.slice(0, 5)) out.push(err(lines[d.id], `node ${d.id} leaves the player with no choice when the flags are [${d.flags.join(', ') || 'none'}]`));
    if (ex.endings.size < 2) out.push(err(1, `only ${ex.endings.size} ending can be reached; a choose-your-path story needs at least two`));
    if (ex.truncated) out.push(warn(1, 'the graph is too large to explore fully; reachability was checked on part of it'));
    const setFlags = new Set(order.flatMap((id) => nodes[id].sets));
    for (const id of order) for (const c of nodes[id].choices) for (const f of [...c.if, ...c.unless]) {
      if (!setFlags.has(f)) out.push(err(c.line, `node ${id}: flag "${f}" is tested but no node sets it`));
    }
  }
  return out;
}
