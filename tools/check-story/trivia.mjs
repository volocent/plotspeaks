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
    const h = /^##\s+(Category|Estimate|Final)\s+(.+?)\s*$/i.exec(line);
    if (h) { cur = { name: h[2].trim(), final: /^final$/i.test(h[1]), estimate: /^estimate$/i.test(h[1]), clues: [], line: i + 1 }; categories.push(cur); return; }
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
    // An estimate row's answer is a number ("8,849"); its unit, said after the figure, is the first "Also accept".
    if (cur.estimate) { const q = cur.clues[cur.clues.length - 1]; q.num = Number(String(q.answer).replace(/,/g, '')); }
  });
  // On a board with estimate categories, a final whose answers are all plain numbers is an estimate too
  // (its heading stays "## Final <name>"). Elsewhere a numeric final (a year) is matched as text.
  if (categories.some((c) => c.estimate)) {
    for (const c of categories) {
      if (c.final && c.clues.length && c.clues.every((q) => /^\d[\d,]*(\.\d+)?$/.test(q.answer))) {
        c.estimate = true;
        for (const q of c.clues) q.num = Number(q.answer.replace(/,/g, ''));
      }
    }
  }
  return { categories };
}

const ARTICLES = /^(the|a|an)\s+/;
// Spoken lead-ins that aren't part of an answer: "what is", "I think it's", "is it", "maybe".
// Also spoken filler ("um", "uh") and a leading "I"/"they're" (2026-10-17 QA: "um is it the stars"
// and "I curtsy" were refused). Keys are normalised the same way, so both sides lose the same words.
const LEAD = /^(what|who|where|when)\s+(is|are|was|were)\s+|^(um+|uh+|er+|erm|hmm+|ah+|oh|well|so|okay|ok|i think|i guess|i bet|maybe|perhaps|is it|it is|its|it s|could it be|how about|the answer is|my answer is|answer|they re|theyre|they are|that s|thats|that is|it was|it s got to be|its got to be|it has to be|it must be|got to be|has to be|must be|i d say|id say|i would say|i m gonna say|im gonna say|i m going to say|im going to say|i ll say|ill say|i ll go with|ill go with|let s go with|lets go with|that would be|that d be|thatd be|in the year|the year|year|i|we)\s+/;
/** Lower case, no lead-in, no leading article, no punctuation, single spaces. */
export function normAnswer(s) {
  let t = String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[’']/g, '').replace(/&/g, ' and ').replace(/\bmt\b\.?/g, 'mount').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 5 && LEAD.test(t); i++) t = t.replace(LEAD, '');
  // A trailing hedge ("south I think", "Paris maybe") isn't part of the answer either.
  t = t.replace(/\s+(i think|i guess|i reckon|maybe|perhaps|probably|right)$/, '');
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
 * spelling slip (one letter in eight, never in a number), or the key's last word when the key
 * is a person's full name and the clue is about a person ("Curie" for "Marie Curie"). Anything else is the challenge's job.
 */
const EXACT = /\d|\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi)\b/;
const VOWEL = /[aeiouy]/;
function vowelSlip(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (++diff > 1 || !VOWEL.test(a[i]) || !VOWEL.test(b[i])) return false;
  }
  return diff === 1;
}
const PERSON =/\b(who|he|she|his|her|him|this (person|man|woman|scientist|author|writer|poet|novelist|playwright|artist|painter|sculptor|composer|musician|singer|rapper|inventor|explorer|president|leader|king|queen|emperor|pharaoh|actor|actress|director|player|athlete|coach|pitcher|quarterback|astronaut|physicist|chemist|philosopher|general|aviator))\b/i;
export function answerMatches(said, clue) {
  // "Tony Stark (Iron Man)": either the answer or the aside in brackets may be the match.
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(String(said ?? ''));
  if (paren && (answerMatches(paren[1], clue) || answerMatches(paren[2], clue))) return true;
  const got = normAnswer(said);
  if (!got) return false;
  // The surname rule only for a clue about a person ("She won...", "This painter..."): otherwise
  // "Virginia" would pass for West Virginia and "Island" for Rhode Island.
  const aboutPerson = PERSON.test((clue.steps ?? []).join(' '));
  for (const key of [clue.answer, ...clue.also].map(normAnswer).filter(Boolean)) {
    if (got === key) return true;
    // Numbers are exact, in digits, in words ("nineteen sixty-eight" is not 1958) or as Roman numerals
    // ("Elizabeth II" is not Elizabeth I): a one-letter slip there is a different answer (2026-10-17 QA).
    if (EXACT.test(key) || EXACT.test(got)) continue;
    // A spelling slip only on answers of eight letters or more: on shorter ones a single letter turns
    // one real answer into another ("Ireland" and "Iceland", "Hungary" and "hungry").
    // Six or seven letters: only one vowel heard as another ("Jupitar"), which rarely makes a new word.
    if (key.length >= 8 && distance(got, key) <= Math.floor(key.length / 8)) return true;
    if (key.length >= 6 && vowelSlip(got, key)) return true;
    const parts = key.split(' ');
    if (aboutPerson && parts.length === 2 && parts[1].length >= 4 && got === parts[1]) return true;
  }
  return false;
}

/**
 * The "Also accept" entry a spoken answer matched exactly (after normalising), when it is another name
 * for the answer and not the answer itself: "Czechia" for "Czech Republic". null otherwise. The host
 * uses it to say the answer counts and which name the board prefers (Julia's play, 2026-10-19).
 */
export function altMatch(said, clue) {
  const got = normAnswer(said);
  if (!got || got === normAnswer(clue.answer)) return null;
  return (clue.also ?? []).find((a) => normAnswer(a) === got) ?? null;
}

const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const NUMWORD = new Set([...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(SCALES), 'hundred', 'point', 'half', 'a', 'and']);

/**
 * The first number in a spoken answer, or null: digits ("8,849", "1.5 million", "5k"), words ("twelve
 * hundred", "a hundred and fifty", "three point five") or a mix. Used for estimate questions, where
 * the closeness of the figure is scored, not an exact match. "About", "around" and units are ignored.
 */
export function parseSpokenNumber(said) {
  const toks = String(said ?? '').toLowerCase().replace(/[’']/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/(\d)\s*k\b/g, '$1 thousand').replace(/[^a-z0-9.\- ]+/g, ' ').replace(/(\d)\.(?!\d)/g, '$1').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const isNum = (t) => /^-?\d+(\.\d+)?$/.test(t) || t in UNITS || t in TENS || t in SCALES || t === 'hundred' || t === 'point';
  let i = 0;
  while (i < toks.length && !isNum(toks[i]) && !(toks[i] === 'a' && /^(hundred|thousand|million|billion|trillion)$/.test(toks[i + 1] ?? ''))) i++;
  if (i >= toks.length) return null;
  const neg = toks[i - 1] === 'minus' || toks[i - 1] === 'negative' || (toks[i] ?? '').startsWith('-');
  let total = 0, cur = 0, seen = false, frac = false, fracDigits = '';
  for (; i < toks.length; i++) {
    let t = toks[i];
    if (t === 'and' && isNum(toks[i + 1] ?? '') && seen) continue;
    if (t === 'a' && /^(hundred|thousand|million|billion|trillion)$/.test(toks[i + 1] ?? '')) { cur = 1; seen = true; continue; }
    if (!isNum(t)) break;
    seen = true;
    if (frac) { if (/^\d+$/.test(t)) fracDigits += t; else if (t in UNITS && UNITS[t] < 10) fracDigits += UNITS[t]; else break; continue; }
    if (t === 'point') { frac = true; continue; }
    if (/^-?\d+(\.\d+)?$/.test(t)) cur += Math.abs(Number(t));
    else if (t in UNITS) cur += UNITS[t];
    // A tens word straight after another number under 100 reads as a year ("nineteen sixty eight", "twenty twenty four").
    else if (t in TENS) cur = cur >= 10 && cur < 100 ? cur * 100 + TENS[t] : cur + TENS[t];
    else if (t === 'hundred') cur = (cur || 1) * 100;
    else if (t in SCALES) { total += (cur || 1) * SCALES[t]; cur = 0; }
  }
  if (!seen) return null;
  const v = total + cur + (fracDigits ? Number(`0.${fracDigits}`) : 0);
  return neg ? -v : v;
}

/** Closeness of a guess to the true figure: "exact", "close" (within 5%), "near" (within 15%) or "far". */
export function estimateBand(guess, truth) {
  if (guess === truth) return 'exact';
  const err = Math.abs(guess - truth) / (Math.abs(truth) || 1);
  return err <= 0.05 ? 'close' : err <= 0.15 ? 'near' : 'far';
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
      if (c.estimate && !(Number.isFinite(q.num) && q.answer)) out.push(err(q.line, `the ${q.value} clue in estimate category "${c.name}" needs a number as its answer (digits, commas allowed)`));
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
  return { categories: categories.map((c) => ({ name: c.name, final: c.final, ...(c.estimate ? { estimate: true } : {}), clues: c.clues.map(({ value, steps, answer, also, asOf, num }) => ({ value, steps, answer, also, asOf, ...(c.estimate ? { num } : {}) })) })) };
}
