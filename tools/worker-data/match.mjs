// Matching spoken requests to stories and accused names (review 2026-10-16, S1/S2/B2). Pure.
// Used by the Worker (worker/src/index.ts) for the MCP tools and the passenger API.

const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[‘’]/g, "'").replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();

function editDistance(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
const similarity = (a, b) => 1 - editDistance(a, b) / Math.max(a.length, b.length, 1);

// ------------------------------------------------------------------ stories

const STOP = new Set(['the', 'a', 'an', 'of', 'at', 'story', 'mystery', 'plot', 'speaks', 'with', 'play', 'start', 'game']);
const words = (s) => norm(s).replace(/'s\b/g, '').replace(/['-]/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w));

/** Best similarity of one requested word against a story's words: 1 exact, else ≥0.6 (speech noise: "host" for "toast"). */
function wordScore(w, have) {
  let best = 0;
  for (const h of have) {
    if (h === w) return 1;
    if (w.length >= 3 && h.length >= 3) {
      const sim = similarity(w, h);
      if (sim >= 0.6 && sim > best) best = sim;
    }
  }
  return best;
}

/**
 * Finds the story a request names. Returns { story } or { story: null, candidates } (up to three
 * near titles, best first). Exact slug or title wins; then a title that contains the whole request
 * (if only one does); then a fuzzy match that covers at least 60% of the request's significant words,
 * at least two of them when the request has two or more, and beats the runner-up. Nothing else:
 * "", "the" or one shared word never starts a story.
 */
export function matchStory(request, stories) {
  const want = norm(request);
  if (!want || want.replace(/[^a-z0-9]/g, '').length < 2) return { story: null, candidates: [] };
  const exact = stories.find((s) => s.slug === request.trim().toLowerCase() || norm(s.slug).replace(/-/g, ' ') === want.replace(/-/g, ' ') || norm(s.title) === want
    || norm(s.title).replace(/^the /, '') === want.replace(/^the /, ''));
  if (exact) return { story: exact };
  const ww = words(request);
  if (!ww.length) return { story: null, candidates: [] };
  const containing = stories.filter((s) => ` ${norm(s.title)} `.includes(` ${want} `));
  if (containing.length === 1 && ww.length >= 1 && want.length >= 4) return { story: containing[0] };
  const scored = stories.map((s) => {
    const have = [...new Set([...words(s.title), ...words(s.slug)])];
    const per = ww.map((w) => wordScore(w, have));
    return { s, score: per.reduce((a, b) => a + b, 0), hits: per.filter((x) => x > 0).length };
  }).filter((x) => x.hits > 0).sort((a, b) => b.score - a.score || a.s.title.localeCompare(b.s.title));
  const best = scored[0];
  const candidates = scored.slice(0, 3).map((x) => x.s);
  if (!best) return { story: null, candidates };
  const needHits = ww.length >= 2 ? 2 : 1;
  const second = scored[1]?.score ?? 0;
  if (best.score >= 0.6 * ww.length && best.hits >= needHits && best.score - second >= 0.5) return { story: best.s };
  return { story: null, candidates };
}

// ------------------------------------------------------------------ accusations

const TITLE_WORDS = new Set(['father', 'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'lady', 'lord', 'sister', 'brother', 'herr', 'frau', 'coach', 'captain', 'judge', 'sheriff', 'madam']);
const FILLER = new Set(['the', 'and', 'or', 'of', 'a', 'an', 'one', 'his', 'her', 'own']);
const nameTokens = (s) => norm(s).replace(/'s\b/g, '').replace(/'/g, '').split(/[\s-]+/).filter((t) => t.length > 1 && !FILLER.has(t));

/**
 * Matches an accused name to an Endings detail entry. Returns
 *   { ending }                     one clear match
 *   { ending: null, candidates }   several equally good matches (names sorted), ask which
 *   { ending: null, candidates: [] } nothing matched
 * Name words count 1 (0.75 for a near spelling, as speech recognition gives), title words
 * ("Mr", "Mrs", "Dr") half. A match needs at least one name word, and must beat the runner-up by
 * a full point; otherwise every ending within that point is a candidate.
 */
export function matchEnding(endings, accused) {
  const want = norm(accused);
  if (!want) return { ending: null, candidates: [] };
  const exact = endings.find((e) => norm(e.name.replace(/\*\*/g, '')) === want);
  if (exact) return { ending: exact };
  const acc = nameTokens(accused);
  const scored = endings.map((e) => {
    const et = nameTokens(e.name);
    let score = 0, nameHit = false;
    for (const t of acc) {
      const title = TITLE_WORDS.has(t);
      if (et.includes(t)) { score += title ? 0.5 : 1; if (!title) nameHit = true; continue; }
      if (!title && t.length >= 4) {
        const near = et.filter((x) => !TITLE_WORDS.has(x) && x.length >= 4).some((x) => similarity(t, x) >= 0.8);
        if (near) { score += 0.75; nameHit = true; }
      }
    }
    return { e, score: nameHit ? score : 0 };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { ending: null, candidates: [] };
  const [best, second] = scored;
  if (!second || best.score - second.score >= 1) return { ending: best.e };
  const candidates = scored.filter((x) => best.score - x.score < 1).map((x) => x.e.name).sort((a, b) => a.localeCompare(b));
  return { ending: null, candidates };
}

export const sortedNames = (endings) => endings.map((e) => e.name).sort((a, b) => a.localeCompare(b));
