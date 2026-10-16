// Pure helpers (no I/O) so they can be unit-tested.

export function normalizeName(s) {
  return String(s).toLowerCase().replace(/\*\*/g, '').replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Parse `- **Name (correct):** text` lines from the `## Endings detail` section. */
export function parseEndings(secretsMd) {
  const m = secretsMd.match(/^##\s+Endings detail\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return [];
  const out = [];
  for (const line of m[1].split(/\r?\n/)) {
    const lm = line.match(/^\s*[-*]\s+\*\*(.+?)\s*\((correct|wrong)\)\s*:?\s*\*\*\s*:?\s*(.+)$/i);
    if (lm) out.push({ name: lm[1].trim(), verdict: lm[2].toLowerCase(), text: lm[3].trim() });
  }
  return out;
}

/**
 * Parse secrets.md's `## Full reveal` section (docs/FORMAT.md):
 *   **Read aloud:** <one or more paragraphs>
 *   **What became of them:**
 *   - <Name>: <one sentence>
 * read_aloud is everything between the two labels (paragraphs kept, trimmed); afterward is the
 * bullet list after the second label. Returns null when the section or its Read aloud part is missing.
 */
export function parseFullReveal(secretsMd) {
  const s = String(secretsMd ?? '').replace(/\r\n?/g, '\n');
  const m = /^##\s+Full reveal\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(s);
  if (!m) return null;
  const sec = m[1];
  const ra = /\*\*Read aloud:\*\*\s*([\s\S]*?)(?=^\*\*What became of them:?\*\*|(?![\s\S]))/im.exec(sec);
  if (!ra || !ra[1].trim()) return null;
  const read_aloud = ra[1].trim().replace(/\n{3,}/g, '\n\n');
  const after = /^\*\*What became of them:?\*\*:?\s*([\s\S]*)$/im.exec(sec);
  const afterward = after
    ? after[1].split('\n').map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[*]\s+/, '- ')).join('\n')
    : '';
  return { read_aloud, afterward: afterward || null };
}

const TITLES = new Set(['father', 'sister', 'brother', 'dr', 'mr', 'mrs', 'ms', 'miss', 'judge', 'sheriff', 'the', 'lord', 'lady', 'sir']);
function tokens(name) {
  return normalizeName(name).split(' ').filter((t) => t.length > 1 && !TITLES.has(t));
}

/** Match an accused name to an endings entry on full, first or last name. */
export function findEnding(endings, accusedName) {
  if (!accusedName) return null;
  const acc = tokens(accusedName);
  if (!acc.length) return null;
  let best = null, bestScore = 0;
  for (const e of endings) {
    const et = tokens(e.name);
    let score = 0;
    if (normalizeName(e.name) === normalizeName(accusedName)) score = 100;
    else {
      for (const t of acc) if (et.includes(t)) score += 1;
      if (et.length && (acc.includes(et[0]) || acc.includes(et[et.length - 1]))) score += 1;
      // A mixed-up name ("Ada Holt" for Ada Quill vs Bram Holt): favour the
      // first name said, as a passenger would.
      if (et.length && acc[0] === et[0]) score += 0.5;
    }
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

/** Find the accused name in the player's "I accuse ..." line. */
export function parseAccusation(text) {
  if (!text) return null;
  // "Mr. Bram": drop the honorific's period so it doesn't end the name.
  text = String(text).replace(/\b(Mr|Mrs|Ms|Dr|St|Fr)\./g, '$1');
  const m = text.match(/\bI\s+(?:formally\s+)?accuse\s+(?:that\s+)?(.+?)(?=\s+(?:because|since|of|for|as|who|and|with|using|by|in|on|at|from|had|did|was|is)\b|[.,;:!?]|$)/i);
  if (!m) return null;
  const name = m[1].replace(/^(?:the\s+)/i, '').trim();
  // "Theo Bramble, I accuse you": the name comes before the accusation.
  if (/^(?:you|him|her|them)$/i.test(name)) {
    const before = text.match(/([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?),\s*I\s+(?:formally\s+)?accuse\s+(?:you|him|her|them)\b/);
    return before ? before[1] : null;
  }
  return name || null;
}

/** Extract the wrangler-readable parts of `## S<id>` (never the "Wrangler only" part). */
export function extractCue(secretsMd, id) {
  const esc = String(id).replace(/[^A-Za-z0-9]/g, '');
  const re = new RegExp(`^##\\s+S${esc}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im');
  const m = secretsMd.match(re);
  if (!m) return null;
  const body = m[1];
  const part = (label) => {
    const r = new RegExp(`\\*\\*${label}[^*]*:\\*\\*\\s*([\\s\\S]*?)(?=^\\*\\*[A-Z][^\\n]*:\\*\\*|(?![\\s\\S]))`, 'im');
    const pm = body.match(r);
    return pm ? pm[1].trim().replace(/^"|"$/g, '') : null;
  };
  if (!part('Read aloud to the narrator')) return null;
  // A long cue may be split into further "**Read aloud (…, beat 2/2):**" parts; keep them all, in order.
  const reads = [...body.matchAll(/^\*\*Read aloud[^*]*:\*\*\s*([\s\S]*?)(?=^\*\*[A-Z][^\n]*:\*\*|(?![\s\S]))/gim)]
    .map((pm) => pm[1].trim().replace(/^"|"$/g, ''));
  const read = reads.join('\n');
  const nums = part('Numbers \\(read these aloud too');
  return nums ? `${read}\n${nums}` : read;
}

export function wranglerCheckRequested(narratorText) {
  return /wrangler,?\s+check the secrets/i.test(narratorText);
}
export function wranglerCueId(narratorText) {
  const m = narratorText.match(/wrangler,?\s+cue\s+S?(\d+[a-z]?)/i);
  return m ? m[1] : null;
}

/** Strip code fences and pull the first balanced JSON object out of model text. */
export function parseJudgeJson(text) {
  if (!text) return null;
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export function slugFromDir(dir) {
  return dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

export function detectChapter2(text) {
  return /resume from chapter 2|chapter 2\b|chapter two/i.test(text);
}

/** Pregenerated character names from a "## Pregenerated characters" section. */
export function pregenNames(storyMd) {
  const m = storyMd.match(/^##\s+Pregenerated characters[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*[-*]\s+\*\*(.+?)\*\*/gm)].map((x) => x[1].trim());
}

// ---- simulated wrangler (follow-up cues) ----------------------------------------------------

/** Follow-up sections: `## S<n><letter>`. Returns [{id:'3b', title}]. */
export function followupIds(secretsMd) {
  return [...secretsMd.matchAll(/^##\s+S(\d+[a-z])\b\s*[—–-]?\s*(.*)$/gim)].map((m) => ({ id: m[1].toLowerCase(), title: m[2].trim() }));
}

/** What the simulated passenger may see: the "Listen for" table and every section's Wrangler-only part. Never the read-aloud parts. */
export function wranglerBrief(secretsMd) {
  const lf = secretsMd.match(/^###\s+Listen for\s*$([\s\S]*?)(?=^#{2,3}\s|(?![\s\S]))/im);
  const parts = [];
  const re = /^##\s+(S\d+[a-z]?\b[^\n]*)\n([\s\S]*?)(?=^##\s|(?![\s\S]))/gim;
  for (const m of secretsMd.matchAll(re)) {
    const wo = m[2].match(/\*\*Wrangler only[^*]*:\*\*\s*([\s\S]*?)(?=^\*\*[A-Z][^\n]*:\*\*|(?![\s\S]))/im);
    if (wo) parts.push(`${m[1].trim()}\n${wo[1].trim()}`);
  }
  return { listenFor: lf ? lf[1].trim() : '', wranglerOnly: parts.join('\n\n') };
}

/** Parse the passenger model's reply: NONE, or a valid, not-yet-called follow-up id such as "S3b".
 *  When `mainCalled` is given, a follow-up is allowed only after its main cue (S3b needs S3): a
 *  simulated passenger once called a bridge-fight cue while the party was still on the road. */
export function parseCueChoice(text, validIds, called = [], mainCalled = null) {
  if (!text) return null;
  const valid = new Set(validIds.map((s) => s.toLowerCase()));
  const done = new Set(called.map((s) => s.toLowerCase()));
  const mains = mainCalled ? new Set([...mainCalled].map((s) => String(s).toLowerCase())) : null;
  for (const m of String(text).matchAll(/\bS?(\d+[a-z])\b/gi)) {
    const id = m[1].toLowerCase();
    if (mains && !mains.has(id.replace(/[a-z]+$/, ''))) continue;
    if (valid.has(id) && !done.has(id)) return id;
  }
  return null;
}

// ---- ASR noise (seeded, pure) ---------------------------------------------------------------

/** mulberry32 PRNG seeded from a string label; returns () => float in [0,1). */
export function seededRng(label) {
  let h = 1779033703 ^ String(label ?? '').length;
  for (const c of String(label ?? '')) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ASR_LEVELS = {
  low: { brand: 0.3, name: 0.25, word: 0.03 },
  high: { brand: 0.6, name: 0.5, word: 0.08 },
};
export const BRAND_VARIANTS = ['plot speaks', 'plot speak', 'plots peaks', 'plot speeches', 'plaque speaks'];
export const HOMOPHONES = {
  to: ['two', 'too'], two: ['to', 'too'], too: ['to', 'two'], there: ['their'], their: ['there'], for: ['four'], four: ['for'],
  right: ['write'], write: ['right'], hear: ['here'], here: ['hear'], knew: ['new'], new: ['knew'], through: ['threw'], threw: ['through'],
  which: ['witch'], witch: ['which'], scene: ['seen'], seen: ['scene'], rode: ['road'], road: ['rode'], pause: ['paws'], paws: ['pause'],
  sweet: ['suite'], suite: ['sweet'], tale: ['tail'], tail: ['tale'], aloud: ['allowed'], allowed: ['aloud'], accuse: ['a cues'],
};

/** Cast names from the first column of story.md's cast table: capitalised words, parentheticals dropped. Returns [[word,...] per entry]. */
export function castNames(storyMd) {
  const m = storyMd.match(/^##\s+Cast[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  if (!m) return [];
  const out = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const first = line.split('|')[1]?.replace(/\([^)]*\)/g, '').trim();
    if (!first || /^name$/i.test(first) || /^-+$/.test(first)) continue;
    const words = first.split(/\s+/).filter((w) => /^[A-Z][A-Za-z'’-]+$/.test(w));
    if (words.length) out.push(words);
  }
  return out;
}

/** Simple sound-alike manglings of one name word (lowercase, all different from the original). */
export function nameVariants(word) {
  const w = word.toLowerCase();
  const v = new Set();
  if (/(.)\1/.test(w)) v.add(w.replace(/(.)\1/, '$1'));
  if (/c/.test(w)) v.add(w.replace('c', 'k'));
  if (/k/.test(w)) v.add(w.replace('k', 'c'));
  if (/ee/.test(w)) v.add(w.replace('ee', 'ea'));
  if (/ea/.test(w)) v.add(w.replace('ea', 'ee'));
  if (/ou/.test(w)) v.add(w.replace('ou', 'ow'));
  if (/ourne$/.test(w)) v.add(w.replace(/ourne$/, 'orn'));
  if (/y$/.test(w)) v.add(w.replace(/y$/, 'ie'));
  if (w.length >= 9) { const k = Math.round(w.length / 2); v.add(`${w.slice(0, k)} ${w.slice(k)}`); }
  v.delete(w);
  return [...v];
}

/** Imitate car-speech ASR. Pure given (text, level, rng, names). Returns the noisy string. */
export function asrNoise(text, level, rng, names = []) {
  const p = ASR_LEVELS[level];
  if (!p) return text;
  const words = String(text).replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/’/g, "'").split(/\s+/).filter(Boolean);
  const nameMap = new Map(); // lowercase word -> {variants, surname (next word to drop for first-name-only)}
  for (const entry of names) entry.forEach((w, i) => nameMap.set(w.toLowerCase(), { variants: nameVariants(w), next: i === 0 && entry[1] ? entry[1].toLowerCase() : null }));
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const lw = words[i].toLowerCase();
    if (lw === 'plot' && words[i + 1]?.toLowerCase() === 'speaks') {
      out.push(rng() < p.brand ? BRAND_VARIANTS[1 + Math.floor(rng() * (BRAND_VARIANTS.length - 1))] : 'plot speaks');
      i++; continue;
    }
    const nm = nameMap.get(lw);
    if (nm) {
      if (rng() < p.name) {
        const opts = nm.variants.map((x) => ({ s: x }));
        if (nm.next && words[i + 1]?.toLowerCase() === nm.next) opts.push({ s: lw, drop: true });
        if (opts.length) {
          const pick = opts[Math.floor(rng() * opts.length)];
          out.push(pick.s);
          if (pick.drop) i++;
          continue;
        }
      }
      out.push(lw); continue;
    }
    if (rng() < p.word) {
      const h = HOMOPHONES[lw];
      if (h && rng() < 0.8) { out.push(h[Math.floor(rng() * h.length)]); continue; }
      if (!h && rng() < 0.5) continue; // dropped word
      if (h) continue; // dropped word
    }
    out.push(lw);
  }
  return out.join(' ');
}
