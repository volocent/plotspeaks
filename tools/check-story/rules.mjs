// Pure check functions for Plot Speaks stories. No file, git or process access here,
// so this module can be ported into the Phase 2 Worker as-is.
// Every check returns an array of findings: { severity: 'ERROR'|'WARN', line, rule, message, file? }.
// `line` is 1-based within the string passed in. `file` is only set when a check spans files.

export const GENRES = ['murder-mystery', 'adventure', 'horror', 'heist', 'kids'];
export const LICENSES = ['CC-BY-NC-4.0', 'CC-BY-4.0', 'All-Rights-Reserved'];
export const RATINGS = ['G', 'PG', 'PG-13', 'R'];
export const RULES_SYSTEMS = ['none', 'srd-5.2.1', 'orc'];
export const AI_DISCLOSURES = ['human-written', 'ai-assisted', 'ai-generated'];

const err = (line, rule, message, extra = {}) => ({ severity: 'ERROR', line, rule, message, ...extra });
const warn = (line, rule, message, extra = {}) => ({ severity: 'WARN', line, rule, message, ...extra });

export const normalize = (text) => String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const linesOf = (text) => normalize(text).split('\n');

// ---------- front matter ----------

function stripComment(raw) {
  const v = raw.trim();
  if (v.startsWith('"') || v.startsWith("'")) {
    const q = v[0];
    const close = v.indexOf(q, 1);
    if (close > 0) return v.slice(1, close);
  }
  return v.replace(/\s+#.*$/, '').trim();
}

/**
 * Parses the YAML subset used by story.md: top-level scalars, one nested map, # comments,
 * quoted/unquoted strings. Returns { ok, error?, errorLine?, data, metadata, keyLines, endLine }.
 * All values are strings.
 */
export function parseFrontMatter(text) {
  const lines = linesOf(text);
  if (lines[0].trim() !== '---') {
    return { ok: false, error: 'story.md must start with a "---" front-matter block', errorLine: 1, data: {}, metadata: {}, keyLines: {} };
  }
  const data = {};
  const metadata = {};
  const keyLines = {};
  let current = null; // name of the open nested map
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') return { ok: true, data, metadata, keyLines, endLine: i + 1 };
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = /^(\s*)([A-Za-z_][\w-]*):(?:\s+(.*)|\s*)$/.exec(line);
    if (!m) {
      return { ok: false, error: `cannot parse front-matter line: ${line.trim()}`, errorLine: i + 1, data, metadata, keyLines };
    }
    const indented = m[1].length > 0;
    const key = m[2];
    const rest = m[3] === undefined ? '' : stripComment(m[3]);
    if (!indented) {
      if (rest === '') { current = key; data[key] = {}; } else { current = null; data[key] = rest; }
      keyLines[key] = i + 1;
    } else if (current === 'metadata') {
      metadata[key] = rest;
      keyLines['metadata.' + key] = i + 1;
    } else if (current) {
      data[current][key] = rest;
    } else {
      return { ok: false, error: `unexpected indented line: ${line.trim()}`, errorLine: i + 1, data, metadata, keyLines };
    }
  }
  return { ok: false, error: 'front-matter block is never closed with "---"', errorLine: 1, data, metadata, keyLines };
}

const SRD_ATTRIBUTION = [/System Reference Document 5\.2\.1/i, /Creative Commons Attribution 4\.0/i];

/** Rule `front-matter` (and `srd-attribution`). opts.slug = folder name. */
export function checkFrontMatter(text, opts = {}) {
  const fm = parseFrontMatter(text);
  if (!fm.ok) return [err(fm.errorLine, 'front-matter', fm.error)];
  const out = [];
  const { data, metadata, keyLines } = fm;
  const at = (k) => keyLines[k] || 1;

  const name = data.name;
  if (!name || typeof name !== 'string') out.push(err(1, 'front-matter', 'missing required field: name'));
  else {
    if (!/^[a-z0-9-]+$/.test(name) || name.length > 64) out.push(err(at('name'), 'front-matter', `name must be lowercase letters, digits and hyphens, at most 64 chars: "${name}"`));
    if (opts.slug && name !== `plotspeaks-${opts.slug}`) out.push(warn(at('name'), 'front-matter', `name should equal "plotspeaks-${opts.slug}", found "${name}"`));
  }
  const desc = data.description;
  if (!desc || typeof desc !== 'string') out.push(err(1, 'front-matter', 'missing required field: description'));
  else if (desc.length > 1024) out.push(err(at('description'), 'front-matter', `description is ${desc.length} chars (max 1024)`));

  if (!data.license || typeof data.license !== 'string') out.push(err(1, 'front-matter', 'missing required field: license'));
  else if (!LICENSES.includes(data.license)) out.push(err(at('license'), 'front-matter', `license must be one of ${LICENSES.join(', ')}; found "${data.license}"`));

  if (typeof data.metadata !== 'object') out.push(err(1, 'front-matter', 'missing required block: metadata'));
  else {
    const need = (k) => {
      if (metadata[k] === undefined || metadata[k] === '') { out.push(err(at('metadata'), 'front-matter', `missing required field: metadata.${k}`)); return false; }
      return true;
    };
    const oneOf = (k, list) => { if (need(k) && !list.includes(metadata[k])) out.push(err(at('metadata.' + k), 'front-matter', `metadata.${k} must be one of ${list.join('|')}; found "${metadata[k]}"`)); };
    const posInt = (k) => { if (need(k) && !/^[1-9]\d*$/.test(metadata[k])) out.push(err(at('metadata.' + k), 'front-matter', `metadata.${k} must be a positive integer; found "${metadata[k]}"`)); };
    need('title');
    oneOf('genre', GENRES);
    posInt('duration_minutes');
    posInt('chapters');
    if (need('players')) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(metadata.players);
      if (!m || +m[1] < 1 || (m[2] && +m[2] < +m[1])) out.push(err(at('metadata.players'), 'front-matter', `metadata.players must be N or N-M; found "${metadata.players}"`));
    }
    oneOf('rating', RATINGS);
    if (metadata.rating === 'R') out.push(warn(at('metadata.rating'), 'front-matter', 'rating R is not publishable to ChatGPT plugins'));
    if (need('version') && !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(metadata.version)) out.push(err(at('metadata.version'), 'front-matter', `metadata.version must be semver; found "${metadata.version}"`));
    need('author');
    oneOf('voice_ready', ['true', 'false']);
    oneOf('rules_system', RULES_SYSTEMS);
    oneOf('ai_disclosure', AI_DISCLOSURES);
    if (metadata.genre === 'adventure' && metadata.rules_system === 'none') out.push(warn(at('metadata.rules_system'), 'front-matter', 'genre adventure with rules_system none: adventures normally use srd-5.2.1 or orc'));
    if (metadata.rules_system === 'srd-5.2.1' && !SRD_ATTRIBUTION.every((re) => re.test(normalize(text)))) {
      out.push(err(at('metadata.rules_system'), 'srd-attribution', 'rules_system srd-5.2.1 requires the attribution text ("System Reference Document 5.2.1" and "Creative Commons Attribution 4.0") in story.md'));
    }
  }
  return out;
}

// ---------- sections ----------

const headingLine = (lines, re) => lines.findIndex((l) => re.test(l));

/** Rules `required-sections`, `stop-phrase`, `accusation-handoff`, `resume-chapter`. opts.genre / opts.chapters (number) decides whether a missing Cast is an ERROR or a WARN. */
export function checkSections(text, opts = {}) {
  const lines = linesOf(text);
  const out = [];
  if (headingLine(lines, /^##\s+How to run this\b/i) < 0) out.push(err(1, 'required-sections', 'missing "## How to run this" section'));
  if (headingLine(lines, /^##\s+Cast\b/i) < 0) {
    const f = opts.genre === 'adventure' ? warn : err;
    out.push(f(1, 'required-sections', 'missing "## Cast" section' + (opts.genre === 'adventure' ? ' (adventures may use a different heading)' : '')));
  }
  if (headingLine(lines, /^##\s+Chapter\b/i) < 0) out.push(err(1, 'required-sections', 'missing at least one "## Chapter" section'));
  if (headingLine(lines, /^##\s+Endings\b/i) < 0) out.push(err(1, 'required-sections', 'missing "## Endings" section'));

  const gm = headingLine(lines, /^##\s+How to run this\b/i);
  let scope = lines.join('\n');
  let base = 1;
  if (gm >= 0) {
    let end = lines.findIndex((l, i) => i > gm && /^##\s/.test(l));
    if (end < 0) end = lines.length;
    scope = lines.slice(gm, end).join('\n');
    base = gm + 1;
  }
  for (const phrase of ['Plot Speaks, pause the story', 'Plot Speaks, resume', 'Plot Speaks, wrap it up']) {
    if (!scope.includes(phrase)) out.push(err(base, 'stop-phrase', `GM instructions must contain the phrase "${phrase}"`));
  }
  // The skippable how-to-play intro (Ben, 2026-10-16): offered in the GM instructions, beats in its own section.
  if (!scope.includes('jump straight in')) {
    out.push(err(base, 'spoken-intro', 'GM instructions must offer the skippable intro ("…or shall we jump straight in?")'));
  }
  if (!/^##\s+How to play \(spoken intro\)/m.test(lines.join('\n'))) {
    out.push(err(base, 'spoken-intro', 'missing "## How to play (spoken intro)" section'));
  }
  if (opts.genre === 'murder-mystery' && !scope.includes('Wrangler, check the secrets')) {
    out.push(err(base, 'accusation-handoff', 'murder-mystery GM instructions must contain the phrase "Wrangler, check the secrets"'));
  }
  if (opts.chapters > 1 && !scope.includes('resume from chapter')) {
    out.push(err(base, 'resume-chapter', 'GM instructions must contain "resume from chapter" when metadata.chapters > 1'));
  }
  return out;
}

// ---------- chapters ----------

/** Rules `chapters`, `recap-block`, `chapter-duration`, `duration-sum`. opts.expectedChapters / opts.expectedMinutes come from front matter. */
export function checkChapters(text, opts = {}) {
  const lines = linesOf(text);
  const out = [];
  const chapters = [];
  lines.forEach((l, i) => {
    const m = /^##\s+Chapter\s+(\d+)\b(.*)$/i.exec(l);
    if (m) chapters.push({ n: +m[1], start: i, title: m[2] });
  });
  if (opts.expectedChapters !== undefined && opts.expectedChapters !== null && chapters.length !== opts.expectedChapters) {
    out.push(err(chapters[0] ? chapters[0].start + 1 : 1, 'chapters', `metadata.chapters is ${opts.expectedChapters} but story.md has ${chapters.length} "## Chapter" headings`));
  }
  let sum = 0;
  let allTimed = chapters.length > 0;
  for (const ch of chapters) {
    let end = lines.findIndex((l, i) => i > ch.start && /^##\s/.test(l));
    if (end < 0) end = lines.length;
    const body = lines.slice(ch.start + 1, end);
    if (!body.some((l) => /^###\s+Recap block\b/i.test(l))) out.push(err(ch.start + 1, 'recap-block', `Chapter ${ch.n} has no "### Recap block" heading before the next "## " heading`));
    const d = /\(\s*(?:≈|~|about\s+)?\s*(\d+)\s*min/i.exec(ch.title);
    if (!d) { allTimed = false; out.push(warn(ch.start + 1, 'chapter-duration', `Chapter ${ch.n} heading has no duration like "(≈30 min)"`)); }
    else {
      const mins = +d[1];
      sum += mins;
      if (mins < 20 || mins > 40) out.push(err(ch.start + 1, 'chapter-duration', `Chapter ${ch.n} is ${mins} min; chapters must be 20-40 min`));
    }
  }
  if (allTimed && opts.expectedMinutes && Math.abs(sum - opts.expectedMinutes) > 10) {
    out.push(warn(chapters[0].start + 1, 'duration-sum', `chapter durations add up to ${sum} min but metadata.duration_minutes is ${opts.expectedMinutes}`));
  }
  return out;
}

// ---------- read-aloud ----------

const NEVER_END = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'e.g', 'i.e', 'prof', 'mt']);
const END_IF_CAPITAL = new Set(['etc', 'a.m', 'p.m']);

/** Counts sentences in a string. Handles abbreviations, decimals/times, ellipses, closing quotes. */
export function countSentences(text) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (!s) return 0;
  const re = /([.!?…]+)(["'”’)\]]*)(\s+|$)/g;
  let count = 0;
  let lastCut = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    const punct = m[1];
    const after = s.slice(m.index + m[0].length);
    if (after === '') { count++; lastCut = s.length; break; }
    const next = after[0];
    // A boundary needs a capital, digit, or opening quote to follow ("said?" she asked. stays one sentence).
    if (!/[A-Z0-9"“‘'(\[]/.test(next)) continue;
    const before = s.slice(lastCut, m.index);
    if (punct === '.') {
      const word = (/([A-Za-z.]+)$/.exec(before) || [])[1] || '';
      const w = word.toLowerCase().replace(/^\.+/, '');
      if (NEVER_END.has(w)) continue;
      if (w === 'no' && /^\d/.test(next)) continue;
      if (END_IF_CAPITAL.has(w) && !/[A-Z"“‘']/.test(next)) continue;
      if (/^[A-Z]$/.test(word) && /^[A-Z]/.test(next)) continue; // initial, e.g. "J. Smith"
    }
    count++;
    lastCut = m.index + m[0].length;
  }
  if (lastCut < s.length && s.slice(lastCut).trim()) count++;
  return count;
}

const stripMd = (t) => t.replace(/[*_]/g, '');

/**
 * Rule `cold-open`: unlabelled paragraphs between the `# Title` line and the first
 * `## ` heading are the cold open the narrator reads aloud, so the 3-sentence cap
 * applies to each. Labelled `**Read aloud (...):**` beats are left to `read-aloud`.
 */
export function checkColdOpen(text) {
  const lines = linesOf(text);
  const out = [];
  const h1 = lines.findIndex((l) => /^# /.test(l));
  if (h1 < 0) return out;
  let i = h1 + 1;
  while (i < lines.length && !/^## /.test(lines[i])) {
    if (lines[i].trim() === '' || /^\*\*Read aloud/.test(lines[i])) { i++; continue; }
    const start = i;
    let body = '';
    while (i < lines.length && lines[i].trim() !== '' && !/^#/.test(lines[i])) body += ' ' + lines[i++];
    const n = countSentences(stripMd(body));
    if (n > 3) out.push(err(start + 1, 'cold-open', `cold-open paragraph has ${n} sentences (max 3); split it into **Read aloud (cold open, beat N):** beats`));
  }
  return out;
}

/** Rule `read-aloud`: more than 3 sentences is an ERROR, exactly 1 a WARN. */
export function checkReadAloud(text) {
  const lines = linesOf(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    // Matches **Read aloud:**, labelled beats like **Read aloud (cold open, beat 1):**,
    // and secrets.md cue parts **Read aloud to the narrator:**.
    const m = /^\*\*Read aloud(?: \([^)]*\)| to the narrator)?:\*\*\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let body = m[1];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (l === '' || /^(\*\*|#|[-*>|]\s)/.test(l)) break;
      body += ' ' + l;
    }
    const n = countSentences(stripMd(body));
    if (n > 3) out.push(err(i + 1, 'read-aloud', `read-aloud beat has ${n} sentences (max 3)`));
    else if (n === 1) out.push(warn(i + 1, 'read-aloud', 'read-aloud beat has 1 sentence (format asks for 2-3)'));
    else if (n === 0) out.push(warn(i + 1, 'read-aloud', 'read-aloud beat is empty'));
  }
  return out;
}

// ---------- audio cues ----------

const PROHIBITION = /\b(never|no|not|nor|don'?t|do not|without|avoid|cannot|can'?t)\b/i;
const IMPERATIVE = /\b(say|speak|read|answer|reply|respond|use|do|perform|adopt|put on|switch|change|deliver)\b/i;
const CUE_WORDS = /\b(sfx|sound ?effects?|music|thunder|whispers?|laughs?|pause|sighs?|gasps?|sobs?|screams?|cheers?|applause)\b/i;

const CUE_PATTERNS = [
  { re: /♪|♫/g, what: 'music note symbol' },
  { re: /\bSFX\b/g, what: 'SFX token' },
  { re: /\((?:sfx|sound|music|voice|accent)\b[^)\n]*\)/gi, what: 'parenthesised audio cue' },
  { re: /\bmusic\s+(?:swells?|plays?|fades?|starts?|rises?|cues?)\b/gi, what: 'music cue' },
  { re: /\bplay\s+(?:some\s+|the\s+|a\s+)?(?:music|sound|song)\b/gi, what: 'play-audio instruction' },
  { re: /\bsound\s+effects?\s*:/gi, what: 'sound effect cue' },
  { re: /\bsound\s+cue\b/gi, what: 'sound cue' },
  { re: /\bcue\s+the\b/gi, what: '"cue the" instruction' },
  { re: /\bswitch(?:es|ing)?\s+(?:to|into)\s+(?:an?\s+|the\s+|your\s+)?(?:[\w'-]+\s+){0,3}?voice\b/gi, what: 'voice-switching instruction' },
  { re: /\bchange\s+(?:your|the)\s+voice\b/gi, what: 'voice-switching instruction' },
  { re: /\buse\s+a\s+different\s+voice\b/gi, what: 'voice-switching instruction' },
  { re: /\bin\s+an?\s+(?:deep|gravelly|squeaky|robotic|different)\s+voice\b/gi, what: 'voice instruction', needsImperative: true },
];

function clauseBefore(line, index) {
  const before = line.slice(0, index);
  const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf(';'));
  return before.slice(cut + 1);
}

/** Rule `no-audio-cues`: production cues, not prose about sound. Run on story.md and secrets.md. Prohibitions ("never produce sound effects") are exempt. */
export function checkAudioCues(text) {
  const lines = linesOf(text);
  const out = [];
  lines.forEach((line, i) => {
    const hits = [];
    for (const m of line.matchAll(/\[([^\]\n]*)\](?!\()/g)) {
      const c = m[1].trim();
      if (c === '' || /^[xX]$/.test(c) || /^(\.\.\.|…)$/.test(c) || /^sic$/i.test(c) || /^\d+$/.test(c)) continue;
      if (/^(sound|sfx|music|voice|accent)/i.test(c) || /^[a-z]{3,}$/.test(c) || CUE_WORDS.test(c)) {
        hits.push({ index: m.index, text: m[0], what: 'bracketed audio/stage cue' });
      }
    }
    for (const p of CUE_PATTERNS) {
      for (const m of line.matchAll(p.re)) {
        if (p.needsImperative && !IMPERATIVE.test(clauseBefore(line, m.index))) continue;
        hits.push({ index: m.index, text: m[0], what: p.what });
      }
    }
    for (const h of hits.sort((a, b) => a.index - b.index)) {
      if (PROHIBITION.test(clauseBefore(line, h.index))) continue;
      out.push(err(i + 1, 'no-audio-cues', `${h.what}: "${h.text}"`));
    }
  });
  return out;
}

// ---------- denylist ----------

/** Parses denylist.txt content: one entry per line, # comments, blank lines ignored. */
export function parseDenylist(text) {
  return normalize(text).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s) => s.replace(/[’‘]/g, "'");

/** Rule `denylist`: case-insensitive whole-word/phrase match. `denylist` is an array of terms or the raw file text. */
export function checkDenylist(text, denylist) {
  const entries = Array.isArray(denylist) ? denylist : parseDenylist(denylist);
  const compiled = entries.map((term) => ({
    term,
    re: new RegExp('(?<![\\p{L}\\p{N}])' + escapeRe(fold(term)).replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])', 'giu'),
  }));
  const out = [];
  linesOf(text).forEach((raw, i) => {
    const line = fold(raw);
    for (const { term, re } of compiled) {
      for (const m of line.matchAll(re)) out.push(err(i + 1, 'denylist', `protected or disallowed term "${m[0]}" (denylist entry: ${term})`));
    }
  });
  return out;
}

// ---------- wrangler cues ----------

/** Rule `wrangler-cues`: every cue in story.md needs a "## S<n>" heading in secrets.md; uncued secrets sections WARN. */
export function checkWranglerCues(storyText, secretsText) {
  const out = [];
  const cued = new Set();
  const headings = new Map();
  linesOf(secretsText || '').forEach((line, i) => {
    const m = /^##\s+(S\d+[a-z]?)(?=[\s\-—–]|$)/.exec(line);
    if (m && !headings.has(m[1])) headings.set(m[1], i + 1);
  });
  linesOf(storyText).forEach((line, i) => {
    const m = /\*\*Wrangler cue:\*\*\s*(.*)$/.exec(line);
    if (!m) return;
    const ids = m[1].match(/\bS\d+[a-z]?\b/g) || [];
    if (ids.length === 0) out.push(err(i + 1, 'wrangler-cues', 'Wrangler cue names no section id (expected S<n>)', { file: 'story.md' }));
    for (const id of ids) {
      cued.add(id);
      if (!headings.has(id)) out.push(err(i + 1, 'wrangler-cues', `Wrangler cue ${id} has no "## ${id}" heading in secrets.md`, { file: 'story.md' }));
    }
  });
  // "cue S3b" mentioned anywhere in either file needs its section
  for (const [file, text] of [['story.md', storyText], ['secrets.md', secretsText]]) {
    linesOf(text || '').forEach((line, i) => {
      for (const m of line.matchAll(/\bcue\s+(S\d+[a-z]?)\b/gi)) {
        const id = 'S' + m[1].slice(1);
        if (!headings.has(id)) out.push(err(i + 1, 'wrangler-cues', `"cue ${id}" has no "## ${id}" heading in secrets.md`, { file }));
      }
    });
  }
  for (const [id, line] of headings) {
    // follow-up sections (S3b) are called by the wrangler, so a cued base S3 covers them
    if (!cued.has(id) && !cued.has(id.replace(/[a-z]$/, ''))) out.push(warn(line, 'wrangler-cues', `secrets.md section ${id} is never cued from story.md`, { file: 'secrets.md' }));
  }
  return out;
}

/** Rule `cue-parts`: each "## S<n>" section in secrets.md should have both labelled parts (WARN). */
export function checkCueParts(secretsText) {
  const lines = linesOf(secretsText || '');
  const out = [];
  lines.forEach((l, i) => {
    if (!/^##\s+S\d+[a-z]?(?=[\s\-—–]|$)/.test(l)) return;
    let end = lines.findIndex((x, j) => j > i && /^##\s/.test(x));
    if (end < 0) end = lines.length;
    const body = lines.slice(i + 1, end).join(' ').replace(/[’‘]/g, "'").toLowerCase();
    const id = /S\d+[a-z]?/.exec(l)[0];
    if (!body.includes('**read aloud to the narrator:**')) out.push(warn(i + 1, 'cue-parts', `section ${id} lacks "**Read aloud to the narrator:**"`, { file: 'secrets.md' }));
    if (!body.includes("**wrangler only (don't read):**")) out.push(warn(i + 1, 'cue-parts', `section ${id} lacks "**Wrangler only (don't read):**"`, { file: 'secrets.md' }));
  });
  return out;
}

// ---------- spoiler / hidden clue ----------

const SPOILERS = [/culprit is/i, /the killer is/i, /murderer is/i, /secretly the/i];

/** Rule `spoiler-hint`: cheap leak heuristic on story.md. */
export function checkSpoilerHints(text) {
  const out = [];
  linesOf(text).forEach((line, i) => {
    for (const re of SPOILERS) {
      const m = re.exec(line);
      if (m) out.push(warn(i + 1, 'spoiler-hint', `possible solution leak: "${m[0]}"`));
    }
  });
  return out;
}

/** Rule `hidden-clue`: a murder-mystery with no *hidden* markers is suspect. */
export function checkHiddenClues(text, opts = {}) {
  const n = (normalize(text).match(/\*hidden\*/gi) || []).length;
  if (n === 0 && opts.genre === 'murder-mystery') return [warn(1, 'hidden-clue', 'murder-mystery has no *hidden* clue markers')];
  return [];
}

// ---------- everything that needs only story.md text ----------

/** Runs every text-only check on story.md. The secrets file, wrangler cues and git checks are separate. */
export function checkStoryText(storyText, { slug, denylist = [] } = {}) {
  const fm = parseFrontMatter(storyText);
  const meta = fm.ok ? fm.metadata : {};
  return [
    ...checkFrontMatter(storyText, { slug }),
    ...checkSections(storyText, { genre: meta.genre, chapters: /^\d+$/.test(meta.chapters || '') ? +meta.chapters : undefined }),
    ...checkChapters(storyText, {
      expectedChapters: /^\d+$/.test(meta.chapters || '') ? +meta.chapters : undefined,
      expectedMinutes: /^\d+$/.test(meta.duration_minutes || '') ? +meta.duration_minutes : undefined,
    }),
    ...checkReadAloud(storyText),
    ...checkColdOpen(storyText),
    ...checkAudioCues(storyText),
    ...checkDenylist(storyText, denylist),
    ...checkSpoilerHints(storyText),
    ...checkHiddenClues(storyText, { genre: meta.genre }),
  ];
}
