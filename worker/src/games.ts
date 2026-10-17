// Trivia engine (kind: trivia; docs/FORMAT.md "Trivia", plan sections 4b and 5b).
//
// The narrator never holds the board's answers: game_board says what's left, game_question gives
// one clue (one step of it, for a stepped clue), game_answer checks the player's answer on the server,
// and game_challenge puts a disputed ruling to three different AI models on Workers AI. The ruling
// flips only if at least two of them agree the player's answer was right; every challenge is logged.
// State lives in play_state (migration 0008), like a choose-your-path play.

import { answerMatches } from "../../tools/check-story/trivia.mjs";

export type TriviaClue = { value: number; steps: string[]; answer: string; also: string[]; asOf: string | null };
export type TriviaBoard = { categories: { name: string; final: boolean; clues: TriviaClue[] }[] };
export type TriviaState = {
  // The clue dealt for each "category|value" (an index into that category's pool), fixed at the start.
  deal?: Record<string, number>;
  asked: string[];                 // "category|value" already played
  current: { cat: string; value: number; step: number } | null;
  scores: Record<string, number>;  // by player name
  last: { cat: string; value: number; player: string; answer: string; correct: boolean; worth: number; challenged: boolean } | null;
};
type Ai = { run: (model: string, input: Record<string, unknown>) => Promise<any> };

// Three models that answer directly (checked 2026-10-17). Gemma 4 and Qwen 3 reason before replying
// and returned nothing within the short reply budget, so they always abstained.
export const JUDGES = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-3.1-8b-instruct-fp8"];

const key = (cat: string, value: number) => `${cat.toLowerCase()}|${value}`;
/** A clue's identity for "seen before": its category and answer (stable when clues are added). */
export const clueId = (cat: string, q: TriviaClue) => `${cat.toLowerCase()}|${q.answer.toLowerCase().trim()}`;

/**
 * Deals one clue per category and value (and one final) from the board's pools. Clues the player has
 * seen (signed-in players: their history) are avoided while unseen ones remain; otherwise random.
 */
export function newTrivia(b?: TriviaBoard, seen: Set<string> = new Set(), rand: () => number = Math.random): TriviaState {
  const deal: Record<string, number> = {};
  for (const c of b?.categories ?? []) {
    const values = [...new Set(c.clues.map((q) => q.value))];
    for (const v of c.final ? [c.clues[0]?.value ?? 1000] : values) {
      const pool = c.clues.map((q, i) => ({ q, i })).filter(({ q }) => c.final || q.value === v);
      const fresh = pool.filter(({ q }) => !seen.has(clueId(c.name, q)));
      const from = fresh.length ? fresh : pool;
      if (from.length) deal[key(c.name, v)] = from[Math.floor(rand() * from.length)].i;
    }
  }
  return { deal, asked: [], current: null, scores: {}, last: null };
}

/** The board as this play sees it: only the dealt clue at each value. Older plays without a deal get the first. */
export function dealtBoard(b: TriviaBoard, st: TriviaState): TriviaBoard {
  return {
    categories: b.categories.map((c) => {
      const values = c.final ? [c.clues[0]?.value ?? 1000] : [...new Set(c.clues.map((q) => q.value))].sort((x, y) => x - y);
      const clues = values.map((v) => {
        const i = st.deal?.[key(c.name, v)];
        return i !== undefined && c.clues[i] ? c.clues[i] : c.clues.find((q) => c.final || q.value === v)!;
      }).filter(Boolean).map((q) => (c.final ? { ...q, value: values[0] } : q));
      return { name: c.name, final: c.final, clues };
    }),
  };
}
const board = (b: TriviaBoard) => b.categories.filter((c) => !c.final);
const finalCat = (b: TriviaBoard) => b.categories.find((c) => c.final) ?? null;
const findCat = (b: TriviaBoard, name: string) => {
  const n = name.trim().toLowerCase();
  if (/^final/.test(n)) return finalCat(b);
  return board(b).find((c) => c.name.toLowerCase() === n) ?? board(b).find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase())) ?? null;
};
/** A stepped clue is worth less with each step revealed: full, then two thirds, then a third. */
const worthAt = (value: number, step: number, steps: number) => (steps <= 1 ? value : Math.max(Math.round(value * (steps - step) / steps / 10) * 10, 10));
const player = (name: string | undefined) => (name ?? "").trim().slice(0, 40) || "You";
const scoreLine = (st: TriviaState) => {
  const e = Object.entries(st.scores);
  return e.length ? e.sort((a, b) => b[1] - a[1]).map(([n, s]) => `${n} ${s}`).join(", ") : "no points yet";
};

export function renderBoard(b: TriviaBoard, st: TriviaState): string {
  const left = board(b).map((c) => {
    const vals = c.clues.filter((q) => !st.asked.includes(key(c.name, q.value))).map((q) => q.value);
    return vals.length ? `- ${c.name}: ${vals.join(", ")}` : null;
  }).filter(Boolean);
  const fin = finalCat(b);
  const finalDone = fin ? st.asked.includes(key(fin.name, fin.clues[0]?.value ?? 0)) : true;
  return [
    `SCORES: ${scoreLine(st)}.`,
    left.length ? `LEFT ON THE BOARD (read the categories aloud, not every value, unless asked):\n${left.join("\n")}` : (fin && !finalDone ? `The board is clear. Only the final is left, in the category "${fin.name}": call game_question with category "final".` : "The game is over. Read out the final scores and congratulate the winner."),
    "Ask the player (or whoever's turn it is) to pick a category and a value, then call game_question.",
  ].join("\n\n");
}

export type Step = { text: string; state: TriviaState; error?: boolean; event?: { kind: string; detail: string; verdict?: string } };

export function askQuestion(b: TriviaBoard, st: TriviaState, category: string, value?: number): Step {
  const c = findCat(b, category);
  if (!c) return { text: `There's no category called "${category.slice(0, 60)}". The categories are: ${board(b).map((x) => x.name).join(", ")}.`, state: st, error: true };
  if (c.final && board(b).some((x) => x.clues.some((q) => !st.asked.includes(key(x.name, q.value))))) {
    return { text: "The final comes once the board is clear.", state: st, error: true };
  }
  const q = c.final ? c.clues[0] : c.clues.find((x) => x.value === value) ?? (value === undefined ? c.clues.find((x) => !st.asked.includes(key(c.name, x.value))) : undefined);
  if (!q) return { text: `"${c.name}" has no ${value} clue. Left in it: ${c.clues.filter((x) => !st.asked.includes(key(c.name, x.value))).map((x) => x.value).join(", ") || "nothing"}.`, state: st, error: true };
  if (st.asked.includes(key(c.name, q.value))) return { text: `${c.name} for ${q.value} has been played. Pick another.`, state: st, error: true };
  const next: TriviaState = { ...st, current: { cat: c.name, value: q.value, step: 0 } };
  const stepped = q.steps.length > 1 ? ` This clue comes in ${q.steps.length} steps; a right answer on this first step is worth ${worthAt(q.value, 0, q.steps.length)}.` : "";
  return {
    text: `CLUE (${c.final ? "the final" : `${c.name} for ${q.value}`}; read it aloud exactly):\n${q.steps[0]}\n\nThen let the player answer and call game_answer with what they said and their name.${stepped} You don't have the answer; don't guess it.${q.asOf ? ` (This fact is as of ${q.asOf}.)` : ""}`,
    state: next,
  };
}

export function answerQuestion(b: TriviaBoard, st: TriviaState, said: string, who?: string): Step {
  if (!st.current) return { text: "No clue is open. Call game_board, then game_question for the category and value the player picks.", state: st, error: true };
  const c = findCat(b, st.current.cat);
  const q = c?.final ? c.clues[0] : c?.clues.find((x) => x.value === st.current!.value);
  if (!c || !q) return { text: "That clue couldn't be found; call game_board.", state: { ...st, current: null }, error: true };
  const name = player(who);
  const step = st.current.step;
  const worth = worthAt(q.value, step, q.steps.length);
  const right = answerMatches(said, q);
  if (!right && step + 1 < q.steps.length) {
    // A stepped clue: the next step, for less.
    return {
      text: `NOT YET. Next clue (read it aloud; now worth ${worthAt(q.value, step + 1, q.steps.length)}):\n${q.steps[step + 1]}`,
      state: { ...st, current: { ...st.current, step: step + 1 } },
      event: { kind: "trivia", detail: `${c.name}|${q.value}|step`, verdict: "wrong" },
    };
  }
  const scores = { ...st.scores, [name]: (st.scores[name] ?? 0) + (right ? worth : 0) };
  const next: TriviaState = {
    asked: [...st.asked, key(c.name, q.value)], current: null, scores,
    last: { cat: c.name, value: q.value, player: name, answer: said.slice(0, 200), correct: right, worth, challenged: false },
  };
  const verdict = right
    ? `CORRECT. The answer is ${q.answer}. ${name} scores ${worth}.`
    : `NOT RIGHT. The answer we have is ${q.answer}. No points this time. (If the player thinks their answer should count, they can challenge: call game_challenge.)`;
  return { text: `${verdict}\n\nSCORES: ${scoreLine(next)}.\n\nThen call game_board for what's left.`, state: next, event: { kind: "trivia", detail: `${c.name}|${q.value}`, verdict: right ? "correct" : "wrong" } };
}

/** Three judges, each asked the same yes/no question. A judge that fails or answers unclearly abstains. */
async function vote(ai: Ai, model: string, clue: string, keyText: string, said: string): Promise<boolean | null> {
  try {
    const out = await ai.run(model, {
      max_tokens: 8,
      messages: [
        { role: "system", content: "You judge a spoken trivia game. Decide whether the player's answer should be accepted as correct for the clue: either it means the same as the official answer (a fair spelling, a common alternative name, an acceptable level of detail), or the official answer is wrong and the player's is right. Reply with exactly one word: YES or NO." },
        { role: "user", content: `Clue: ${clue}\nOfficial answer: ${keyText}\nPlayer's answer: ${said}` },
      ],
    });
    const t = String(out?.response ?? out?.choices?.[0]?.message?.content ?? "").trim().toUpperCase();
    return /^YES\b/.test(t) ? true : /^NO\b/.test(t) ? false : null;
  } catch {
    return null;
  }
}

export async function challenge(ai: Ai | undefined, b: TriviaBoard, st: TriviaState): Promise<Step> {
  const l = st.last;
  if (!l) return { text: "There's no ruling to challenge yet.", state: st, error: true };
  if (l.correct) return { text: "That answer was already ruled correct.", state: st, error: true };
  if (l.challenged) return { text: "That ruling has already been challenged once.", state: st, error: true };
  if (!ai) return { text: "Challenges aren't available on this server right now; the ruling stands.", state: st, error: true };
  const c = findCat(b, l.cat);
  const q = c?.final ? c.clues[0] : c?.clues.find((x) => x.value === l.value);
  if (!q) return { text: "That clue couldn't be found; the ruling stands.", state: st, error: true };
  const clue = q.steps.join(" / ");
  const keyText = [q.answer, ...q.also].join(" (also accepted: ") + (q.also.length ? ")" : "");
  const votes = await Promise.all(JUDGES.map((m) => vote(ai, m, clue, keyText, l.answer)));
  const yes = votes.filter((v) => v === true).length;
  const counted = votes.filter((v) => v !== null).length;
  const upheld = yes >= 2;
  const scores = upheld ? { ...st.scores, [l.player]: (st.scores[l.player] ?? 0) + l.worth } : st.scores;
  const next: TriviaState = { ...st, scores, last: { ...l, challenged: true, correct: upheld } };
  const panel = `${yes} of ${counted} judges agreed`;
  return {
    text: upheld
      ? `CHALLENGE UPHELD (${panel}). "${l.answer}" counts: ${l.player} gets ${l.worth}.\n\nSCORES: ${scoreLine(next)}.\n\nThen call game_board.`
      : `CHALLENGE NOT UPHELD (${panel}; it takes two). The ruling stands: the answer we have is ${q.answer}.\n\nSCORES: ${scoreLine(next)}.\n\nThen call game_board.`,
    state: next,
    event: { kind: "challenge", detail: `${l.cat}|${l.value}|${votes.map((v) => (v === null ? "-" : v ? "Y" : "N")).join("")}`, verdict: upheld ? "upheld" : "refused" },
  };
}

export async function loadTrivia(db: D1Database | undefined, playId: string): Promise<TriviaState | null> {
  if (!db) return null;
  const row = await db.prepare("SELECT state FROM play_state WHERE play_id = ? AND kind = 'trivia'").bind(playId).first<{ state: string }>();
  if (!row) return null;
  try { return JSON.parse(row.state) as TriviaState; } catch { return null; }
}
export const saveTrivia = (db: D1Database, playId: string, st: TriviaState) =>
  db.prepare("INSERT INTO play_state (play_id, kind, state, updated_at) VALUES (?, 'trivia', ?, ?) ON CONFLICT(play_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at")
    .bind(playId, JSON.stringify(st), Date.now());
