// Trivia boards (kind: trivia). Parser, answer matching and checks, shared by the lint, the build
// and the Worker. Pure functions on strings.
//
// Format (secrets.md; docs/FORMAT.md "Trivia"):
//
//   ## Category Space
//   | Value | Clue | Answer | Also accept | As of |
//   |---|---|---|---|---|
//   | 100 | The planet named for the Roman god of war. | Mars | the red planet | |
//   | 200 | First clue // a closer clue // the giveaway | Answer | alt one; alt two | 2025 |
//
//   ## Final Space
//   | Value | Clue | Answer | Also accept | As of |
//   |---|---|---|---|---|
//   | 1000 | ... | ... | | |
//
// A clue with steps ("//") reveals one step per wrong answer, each worth less (guess the plot,
// where in the world). "As of" dates a fact that can change.

const nl = (s) => String(s ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');

/** { categories: [{ name, final, clues: [{ value, steps[], answer, also[], asOf, line }] }] } */
export function parseTrivia(secretsText) {
  const lines = nl(secretsText).split('\n');
  const categories = [];
  let cur = null;
  lines.forEach((line, i) => {
    const h = /^##\s+(Category|Final)\s+(.+?)\s*$/i.exec(line);
    if (h) { cur = { name: h[2].trim(), final: /^final$/i.test(h[1]), clues: [], line: i + 1 }; categories.push(cur); return; }
    if (/^#{1,2}\s/.test(line)) { cur = null; return; }
    if (!cur || !/^\|/.test(line) || /^\|\s*-/.test(line) || /^\|\s*value\s*\|/i.test(line)) return;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const [value, clue, answer, also, asOf] = cells;
    cur.clues.push({
      value: Number(value) || 0,
      steps: String(clue ?? '').split(/\s*\/\/\s*/).map((s) => s.trim()).filter(Boolean),
      answer: String(answer ?? '').trim(),
      also: String(also ?? '').split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean),
      asOf: String(asOf ?? '').trim() || null,
      line: i + 1,
    });
  });
  return { categories };
}

const ARTICLES = /^(the|a|an)\s+/;
// Spoken lead-ins that aren't part of an answer: "what is", "I think it's", "is it", "maybe".
const LEAD = /^(what|who|where|when)\s+(is|are|was|were)\s+|^(i think|i guess|i bet|maybe|perhaps|is it|it is|its|it s|could it be|how about|the answer is|my answer is|answer)\s+/;
/** Lower case, no lead-in, no leading article, no punctuation, single spaces. */
export function normAnswer(s) {
  let t = String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3 && LEAD.test(t); i++) t = t.replace(LEAD, '');
  t = t.replace(ARTICLES, '');
  return t.trim();
}

function distance(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return m + n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * Whether a spoken answer matches the key or an accepted alternative: exact after normalising, a
 * spelling slip (about one letter in five, never in a number), or the key's last word when the key
 * is a person's full name ("Curie" for "Marie Curie"). Anything else is the challenge's job.
 */
export function answerMatches(said, clue) {
  // "Tony Stark (Iron Man)": either the answer or the aside in brackets may be the match.
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(String(said ?? ''));
  if (paren && (answerMatches(paren[1], clue) || answerMatches(paren[2], clue))) return true;
  const got = normAnswer(said);
  if (!got) return false;
  for (const key of [clue.answer, ...clue.also].map(normAnswer).filter(Boolean)) {
    if (got === key) return true;
    if (/\d/.test(key) || /\d/.test(got)) continue;
    // A spelling slip only on longer answers: one letter in "glass" makes "class" or "grass".
    if (key.length >= 6 && distance(got, key) <= Math.max(1, Math.floor(key.length / 6))) return true;
    const parts = key.split(' ');
    if (parts.length === 2 && parts[1].length >= 4 && got === parts[1]) return true;
  }
  return false;
}

const err = (line, message) => ({ severity: 'ERROR', line, rule: 'trivia', message, file: 'secrets.md' });
const warn = (line, message) => ({ severity: 'WARN', line, rule: 'trivia', message, file: 'secrets.md' });

/** Rule `trivia`: a playable board with every clue answered, valued and short enough to say. */
export function checkTrivia(secretsText) {
  const { categories } = parseTrivia(secretsText);
  const out = [];
  const board = categories.filter((c) => !c.final);
  if (!board.length) return [err(1, 'a trivia board needs "## Category <name>" sections with a | Value | Clue | Answer | Also accept | As of | table')];
  if (board.length < 3) out.push(warn(1, `only ${board.length} categories; a board usually has six`));
  if (categories.filter((c) => c.final).length > 1) out.push(err(1, 'more than one "## Final" section'));
  const names = new Set();
  for (const c of categories) {
    if (!c.final) {
      if (names.has(c.name.toLowerCase())) out.push(err(c.line, `category "${c.name}" appears twice`));
      names.add(c.name.toLowerCase());
    }
    if (!c.clues.length) out.push(err(c.line, `category "${c.name}" has no clues`));
    if (!c.final) for (const v of [100, 200, 300, 400, 500]) if (c.clues.length && !c.clues.some((q) => q.value === v)) out.push(warn(c.line, `"${c.name}" has no ${v} clue`));
    // A category may hold several clues per value (a pool): each game deals one per value, choosing
    // ones the player hasn't seen when they are signed in. Every value 100 to 500 needs at least one.
    const seenAnswers = new Set();
    for (const q of c.clues) {
      if (!q.value) out.push(err(q.line, `a clue in "${c.name}" has no value`));
      const a = normAnswer(q.answer);
      if (a && seenAnswers.has(a)) out.push(err(q.line, `"${c.name}" has two clues with the answer "${q.answer}"`));
      seenAnswers.add(a);
      if (!q.steps.length) out.push(err(q.line, `a ${q.value} clue in "${c.name}" has no clue text`));
      if (!q.answer) out.push(err(q.line, `the ${q.value} clue in "${c.name}" has no answer`));
      for (const s of q.steps) {
        const w = (s.match(/\S+/g) || []).length;
        if (w > 40) out.push(warn(q.line, `a ${q.value} clue in "${c.name}" is ${w} words; about 30 is easy to hold in your head`));
      }
      if (q.answer && q.steps.some((s) => normAnswer(s).includes(normAnswer(q.answer)) && normAnswer(q.answer).length > 3)) {
        out.push(err(q.line, `the ${q.value} clue in "${c.name}" contains its own answer`));
      }
    }
  }
  return out;
}

/** The board as the Worker serves it. */
export function compileTrivia(secretsText) {
  const { categories } = parseTrivia(secretsText);
  if (!categories.length) return null;
  return { categories: categories.map((c) => ({ name: c.name, final: c.final, clues: c.clues.map(({ value, steps, answer, also, asOf }) => ({ value, steps, answer, also, asOf })) })) };
}
