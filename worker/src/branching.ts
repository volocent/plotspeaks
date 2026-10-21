// Choose-your-path engine (kind: branching; docs/FORMAT.md, plan section 4a).
//
// The narrator never holds the story: start_story returns the opening node and choose returns one
// node per decision. Where the player is, the flags they have switched on and the path they took are
// kept per play in D1 (play_state, migration 0008), so a resume works and a late node can answer an
// early choice. Unvisited nodes never leave the server.
import { answerMatches, normAnswer } from "../../tools/check-story/trivia.mjs";

// A choice with `answer` is a puzzle answer: never shown, taken when the player says one of its words.
export type BranchChoice = { text: string; to: string; if: string[]; unless: string[]; answer?: string[] };
export type BranchNode = { read_aloud: string; notes: string | null; sets: string[]; ending: { name: string; tone: string | null } | null; choices: BranchChoice[] };
export type BranchGraph = { start: string; nodes: Record<string, BranchNode> };
// follow: a shared path being replayed (path_codes): the choices taken, in order. Dropped when the player
// takes another turn.
export type BranchState = { node: string; flags: string[]; path: { from: string; choice: string }[]; ended: boolean; follow?: string[] };

/** The player's path in a few spoken lines: their choices and the ending (long paths keep both ends). */
export function pathSummary(st: BranchState, ending: string): string {
  const picks = st.path.map((p) => p.choice);
  const shown = picks.length > 8 ? [...picks.slice(0, 4), "…", ...picks.slice(-3)] : picks;
  return `${shown.length ? `You chose: ${shown.map((c) => (c === "…" ? c : `"${c}"`)).join(", then ")}.` : "You went straight to the end."} Ending: ${ending}.`;
}
/** The choice the shared path took at this point, if it is on offer here. */
export function followChoice(g: BranchGraph, st: BranchState): BranchChoice | null {
  const want = st.follow?.[st.path.length];
  if (!want) return null;
  const n = g.nodes[st.node];
  if (!n) return null;
  if (want === "solved the puzzle") return null;
  return offered(n, st.flags).find((c) => !c.answer && c.text === want) ?? null;
}

export const offered = (n: BranchNode, flags: string[]) =>
  n.choices.filter((c) => c.if.every((f) => flags.includes(f)) && !c.unless.some((f) => flags.includes(f)));

export function initialState(g: BranchGraph): BranchState {
  const start = g.nodes[g.start];
  return { node: g.start, flags: [...new Set(start?.sets ?? [])].sort(), path: [], ended: Boolean(start?.ending) };
}

const ORDINALS: Record<string, number> = { first: 1, one: 1, second: 2, two: 2, third: 3, three: 3, fourth: 4, four: 4, last: -1 };
// English and Spanish filler words (the Spanish practice stories). Accents are stripped first, so
// "río" and a speech-to-text "rio" are the same word.
const STOP = new Set(["um", "uh", "er", "erm", "hmm", "okay", "the", "a", "an", "to", "and", "of", "i", "we", "go", "let's", "lets", "want", "choose", "pick", "option", "do", "it", "my", "our",
  "for", "with", "into", "on", "at", "in", "is", "think", "maybe",
  "el", "la", "los", "las", "un", "una", "de", "del", "al", "y", "por", "favor", "que", "en", "a", "yo", "me", "quiero", "voy"]);
// Lower case, no apostrophes, punctuation as spaces: "No, never again" and "no never again" are the same.
const flat = (x: string) => x.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const REFUSAL = /\b(dont|do not|not|never|wont|wouldnt|couldnt|shouldnt|cant|cannot)\b/;
const toks = (s: string) => (s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9']+/g) ?? []).filter((t) => !STOP.has(t));

/**
 * Matches what the player said to one of the offered choices: a number ("2", "option 2", "the
 * second"), the exact text, or the choice sharing clearly the most words with it. null when it
 * isn't clear, so the narrator asks again rather than the server guessing.
 */
export function matchChoice(all: BranchChoice[], said: string): BranchChoice | null {
  const s = said.trim().toLowerCase();
  if (!s || !all.length) return null;
  // Puzzle answers first, matched like trivia answers; then the listed choices.
  const solved = all.find((c) => c.answer && answerMatches(said, { answer: c.answer[0], also: c.answer.slice(1) }));
  if (solved) return solved;
  // A puzzle answer of two or more words said inside a longer sentence ("put them outside the hab in
  // the shade") counts, unless the sentence refuses something (2026-10-17 QA). One word alone doesn't:
  // "south east" is not "south".
  const heardAns = ` ${normAnswer(said)} `;
  const refuses = REFUSAL.test(flat(said));
  const within = refuses ? undefined : all.find((c) => c.answer && c.answer.some((a) => { const k = normAnswer(a); return k.includes(" ") && heardAns.includes(` ${k} `); }));
  if (within) return within;
  const open = all.filter((c) => !c.answer);
  if (!open.length) return null;
  // On a puzzle, a bare number ("3", "3 octopuses") is a guess, never "choice 3": only "option 3"
  // or "choice 3" picks by number there.
  // The exact text first: "take 1 coin" is that choice, not choice 1.
  const exact = open.find((c) => flat(c.text) === flat(s));
  if (exact) return exact;
  const puzzle = all.some((c) => c.answer);
  const named = /^(?:option|choice|number)\s+(\d)\b/.exec(s);
  // A number that also appears in a choice's own text ("open door 1") is matched as words, unless
  // the player said "option 1" or "choice 1".
  const loose = puzzle ? null : /^\D{0,12}?(\d)\b/.exec(s);
  const inText = loose && !/^\d$/.test(s) && open.some((c) => new RegExp(`(^|\\D)${loose[1]}(\\D|$)`).test(c.text));
  const num = named ?? (inText ? null : loose);
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= open.length && s.length <= 20) return open[Number(num[1]) - 1];
  if (puzzle && /\d/.test(s)) return null;
  const ord = Object.entries(ORDINALS).find(([w]) => new RegExp(`^(the\\s+)?${w}(\\s+(one|option|choice))?$`).test(s));
  if (ord) return ord[1] === -1 ? open[open.length - 1] : open[ord[1] - 1] ?? null;
  // A refusal ("I don't look", "never open it") rules out the choices built on the refused word, and
  // the word itself doesn't count toward a match (2026-10-17 QA: "I don't look" picked "Look inside").
  const NEG_TEXT = /\b(dont|do not|not|never|no|wont|wouldnt|couldnt|shouldnt|cant|cannot|nothing|none|nobody|neither|leave it)\b/;
  const plainS = s.replace(/['’]/g, "");
  const near = (t: string, w: string) => t === w || (w.length >= 4 && t.length >= 4 && (t.startsWith(w) || w.startsWith(t)));
  // Only a refusal of something a choice offers counts ("no, I'm not scared" refuses nothing listed).
  const negated = new Set([...plainS.matchAll(/\b(?:dont|do not|not|never|no|wont|wouldnt|couldnt|shouldnt|cant|cannot|would not|could not|should not)\s+(?:(?:the|a|it|that|this|want|wanna|to|need|go|really|even|feel|like|i|we|you|them|him|her)\s+)*([a-z]+)/g)].map((m) => m[1])
    .filter((w) => open.some((c) => toks(c.text).some((t) => near(t, w)))));
  const choiceNeg = (c: BranchChoice) => NEG_TEXT.test(c.text.toLowerCase().replace(/['’]/g, ""));
  const cands = negated.size ? open.filter((c) => choiceNeg(c) || !toks(c.text).some((t) => [...negated].some((w) => near(t, w)))) : open;
  if (!cands.length) return null;
  // Between two choices, refusing one ("I wouldn't trust them again") picks the other.
  if (negated.size && open.length === 2 && cands.length === 1) return cands[0];
  // A bare "no" (answering "No, I'm brave") stays a word; only a refusal of something is dropped.
  const want = new Set(negated.size ? toks(s).filter((t) => ![...negated].some((w) => near(t, w)) && !["dont", "don't", "not", "never", "no", "wont", "won't", "wouldn't", "couldn't", "shouldn't", "can't", "want", "wanna", "need"].includes(t)) : toks(s));
  // The words of a refused choice don't count toward another ("don't want to keep walking": not "walking").
  if (negated.size) {
    const refused = open.filter((c) => !cands.includes(c)).flatMap((c) => toks(c.text));
    for (const w of [...want]) if (refused.some((t) => near(t, w))) want.delete(w);
  }
  if (!want.size) {
    // Only a refusal was said: it picks the one choice that is itself a refusal, if there is one,
    // or, between two choices, the other one.
    const refusals = negated.size ? cands.filter(choiceNeg) : [];
    if (refusals.length === 1) return refusals[0];
    return negated.size && open.length === 2 && cands.length === 1 ? cands[0] : null;
  }
  const scored = cands.map((c) => {
    const have = toks(c.text);
    // Whole words, or a shared stem of four letters or more on both sides ("climbing" for "climb"),
    // never a short word inside a longer one ("fork" is not "for").
    // A word of one or two letters ("up", "no") counts only when the player said nothing longer, or
    // in a choice made of such words; a number always counts ("door 3").
    const short = have.every((t) => t.length < 3) || [...want].every((w) => w.length < 3);
    const hits = have.filter((t) => (t.length >= 3 || short || /\d/.test(t)) && (want.has(t) || [...want].some((w) => w.length >= 4 && t.length >= 4 && (t.startsWith(w) || w.startsWith(t))))).length;
    return { c, score: hits / Math.max(1, have.length) + hits * 0.01 };
  }).sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  // One distinctive word ("hotel" for "Hay un hotel cerca") picks a choice when no other choice has it.
  const distinctive = [...want].filter((w) => w.length >= 4);
  const owners = (w: string) => cands.filter((c) => toks(c.text).includes(w));
  const unique = distinctive.map(owners).filter((o) => o.length === 1).map((o) => o[0]);
  if (unique.length && unique.every((c) => c === unique[0])) return unique[0];
  if (best.score < 0.34) return null;
  if (second && best.score - second.score < 0.2) return null;
  return best.c;
}

/** What the narrator gets for a node: the read-aloud, notes, and the choices or the ending. */
export function renderNode(g: BranchGraph, st: BranchState, opts: { resume?: boolean; title: string } = { title: "" }): string {
  const n = g.nodes[st.node];
  if (!n) return "This story's position couldn't be found. Start it again with start_story.";
  const parts: string[] = [];
  if (opts.resume) {
    parts.push(st.path.length
      ? `WHERE THEY ARE (for you; recap it in a sentence or two, in the story's voice): they chose ${st.path.map((p) => `"${p.choice}"`).join(", then ")}.`
      : "WHERE THEY ARE: still at the opening.");
  }
  parts.push(`READ ALOUD (in your own narrator voice):\n${n.read_aloud}`);
  if (n.notes) parts.push(`NARRATOR NOTES (not read aloud):\n${n.notes}`);
  if (n.ending || st.ended) {
    parts.push(`THE END: "${n.ending?.name ?? "The end"}". This ends ${opts.title || "the story"}. ${st.path.length ? `First offer, in one sentence: "Would you like to go back to your last choice and try the other way?" If they do, call choose with go_back: true (it returns that moment again). ` : ""}When they're done, after a pause, ask once whether they'd like to leave feedback (see your instructions), then: "Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or play this one again?" Playing again starts a new play, so different choices lead somewhere else.`);
  } else {
    const open = offered(n, st.flags);
    const shown = open.filter((c) => !c.answer);
    const fc = st.follow ? followChoice(g, st) : null;
    if (st.follow && st.follow[st.path.length] === "solved the puzzle") parts.push("ON A SHARED PATH: at this point they solved the puzzle. Say so, and let the player try it (or pick a choice).");
    else if (fc) parts.push(`ON A SHARED PATH: here they chose "${fc.text}". Say so in a few words; the player can say "next" to take the same turn, or choose differently.`);
    parts.push(`CHOICES (offer these in your own words, briefly and in the story's voice; never add one, never hint at what lies behind one; then call choose with the play id and the player's answer):\n${shown.map((c, i) => `${i + 1}. ${c.text}`).join("\n")}`);
    if (open.some((c) => c.answer)) parts.push("PUZZLE: the player can also try an answer aloud at any time. Pass their exact words to choose; you don't know the answer, so never suggest one or say whether a guess is close.");
  }
  return parts.join("\n\n");
}

/** Applies a choice. Returns the new state; flags only ever switch on. */
export function advance(g: BranchGraph, st: BranchState, c: BranchChoice): BranchState {
  const next = g.nodes[c.to];
  const flags = [...new Set([...st.flags, ...(next?.sets ?? [])])].sort();
  const taken = c.answer ? "solved the puzzle" : c.text;
  // Off the shared path once a different turn is taken.
  const follow = st.follow && st.follow[st.path.length] === taken ? st.follow : undefined;
  return { node: c.to, flags, path: [...st.path, { from: st.node, choice: taken }].slice(-200), ended: Boolean(next?.ending), ...(follow ? { follow } : {}) };
}

/**
 * Goes back one choice, the gamebook reader's finger in the page (Ben, 2026-10-17): the player
 * returns to the node they chose from, with the flags rebuilt from the nodes they had reached by
 * then (flags are only set on arrival, so the path says which). null at the opening.
 */
export function rewind(g: BranchGraph, st: BranchState): BranchState | null {
  const last = st.path[st.path.length - 1];
  if (!last || !g.nodes[last.from]) return null;
  const path = st.path.slice(0, -1);
  const visited = [g.start, ...path.map((p) => p.from), last.from];
  const flags = [...new Set(visited.flatMap((id) => g.nodes[id]?.sets ?? []))].sort();
  return { node: last.from, flags, path, ended: Boolean(g.nodes[last.from]?.ending) };
}

export async function loadState(db: D1Database | undefined, playId: string): Promise<BranchState | null> {
  if (!db) return null;
  const row = await db.prepare("SELECT state FROM play_state WHERE play_id = ?").bind(playId).first<{ state: string }>();
  if (!row) return null;
  try { return JSON.parse(row.state) as BranchState; } catch { return null; }
}

export function saveStateStatement(db: D1Database, playId: string, st: BranchState): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO play_state (play_id, kind, state, updated_at) VALUES (?, 'branching', ?, ?) ON CONFLICT(play_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
  ).bind(playId, JSON.stringify(st), Date.now());
}
