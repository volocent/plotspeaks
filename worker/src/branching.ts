// Choose-your-path engine (kind: branching; docs/FORMAT.md, plan section 4a).
//
// The narrator never holds the story: start_story returns the opening node and choose returns one
// node per decision. Where the player is, the flags they have switched on and the path they took are
// kept per play in D1 (play_state, migration 0008), so a resume works and a late node can answer an
// early choice. Unvisited nodes never leave the server.
import { answerMatches } from "../../tools/check-story/trivia.mjs";

// A choice with `answer` is a puzzle answer: never shown, taken when the player says one of its words.
export type BranchChoice = { text: string; to: string; if: string[]; unless: string[]; answer?: string[] };
export type BranchNode = { read_aloud: string; notes: string | null; sets: string[]; ending: { name: string; tone: string | null } | null; choices: BranchChoice[] };
export type BranchGraph = { start: string; nodes: Record<string, BranchNode> };
export type BranchState = { node: string; flags: string[]; path: { from: string; choice: string }[]; ended: boolean };

export const offered = (n: BranchNode, flags: string[]) =>
  n.choices.filter((c) => c.if.every((f) => flags.includes(f)) && !c.unless.some((f) => flags.includes(f)));

export function initialState(g: BranchGraph): BranchState {
  const start = g.nodes[g.start];
  return { node: g.start, flags: [...new Set(start?.sets ?? [])].sort(), path: [], ended: Boolean(start?.ending) };
}

const ORDINALS: Record<string, number> = { first: 1, one: 1, second: 2, two: 2, third: 3, three: 3, fourth: 4, four: 4, last: -1 };
// English and Spanish filler words (the Spanish practice stories). Accents are stripped first, so
// "río" and a speech-to-text "rio" are the same word.
const STOP = new Set(["the", "a", "an", "to", "and", "of", "i", "we", "go", "let's", "lets", "want", "choose", "pick", "option", "do", "it", "my", "our",
  "for", "with", "into", "on", "at", "in", "is", "think", "maybe",
  "el", "la", "los", "las", "un", "una", "de", "del", "al", "y", "por", "favor", "que", "en", "a", "yo", "me", "quiero", "voy"]);
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
  const open = all.filter((c) => !c.answer);
  if (!open.length) return null;
  // On a puzzle, a bare number ("3", "3 octopuses") is a guess, never "choice 3": only "option 3"
  // or "choice 3" picks by number there.
  const puzzle = all.some((c) => c.answer);
  const num = puzzle ? /^(?:option|choice|number)\s+(\d)\b/.exec(s) : /^\D{0,12}?(\d)\b/.exec(s);
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= open.length && s.length <= 20) return open[Number(num[1]) - 1];
  if (puzzle && /\d/.test(s)) return null;
  const ord = Object.entries(ORDINALS).find(([w]) => new RegExp(`^(the\\s+)?${w}(\\s+(one|option|choice))?$`).test(s));
  if (ord) return ord[1] === -1 ? open[open.length - 1] : open[ord[1] - 1] ?? null;
  const exact = open.find((c) => c.text.toLowerCase() === s);
  if (exact) return exact;
  const want = new Set(toks(s));
  if (!want.size) return null;
  const scored = open.map((c) => {
    const have = toks(c.text);
    // Whole words, or a shared stem of four letters or more on both sides ("climbing" for "climb"),
    // never a short word inside a longer one ("fork" is not "for").
    const hits = have.filter((t) => want.has(t) || [...want].some((w) => w.length >= 4 && t.length >= 4 && (t.startsWith(w) || w.startsWith(t)))).length;
    return { c, score: hits / Math.max(1, have.length) + hits * 0.01 };
  }).sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  // One distinctive word ("hotel" for "Hay un hotel cerca") picks a choice when no other choice has it.
  const distinctive = [...want].filter((w) => w.length >= 4);
  const owners = (w: string) => open.filter((c) => toks(c.text).includes(w));
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
    parts.push(`THE END: "${n.ending?.name ?? "The end"}". This ends ${opts.title || "the story"}. After a pause, ask once whether they'd like to leave feedback (see your instructions), then: "Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or play this one again?" Playing again starts a new play, so different choices lead somewhere else.`);
  } else {
    const open = offered(n, st.flags);
    const shown = open.filter((c) => !c.answer);
    parts.push(`CHOICES (offer these in your own words, briefly and in the story's voice; never add one, never hint at what lies behind one; then call choose with the play id and the player's answer):\n${shown.map((c, i) => `${i + 1}. ${c.text}`).join("\n")}`);
    if (open.some((c) => c.answer)) parts.push("PUZZLE: the player can also try an answer aloud at any time. Pass their exact words to choose; you don't know the answer, so never suggest one or say whether a guess is close.");
  }
  return parts.join("\n\n");
}

/** Applies a choice. Returns the new state; flags only ever switch on. */
export function advance(g: BranchGraph, st: BranchState, c: BranchChoice): BranchState {
  const next = g.nodes[c.to];
  const flags = [...new Set([...st.flags, ...(next?.sets ?? [])])].sort();
  return { node: c.to, flags, path: [...st.path, { from: st.node, choice: c.text }].slice(-200), ended: Boolean(next?.ending) };
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
