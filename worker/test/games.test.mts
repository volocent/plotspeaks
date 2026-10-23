// The trivia engine (worker/src/games.ts) off the server: sizing a game to a drive, and a streak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrivia, dealtBoard, sizeGame, askQuestion, answerQuestion, seeded, learnable, timelineView, type TriviaBoard, type TriviaState } from "../src/games.ts";

test('learnable: a taught name must be a short, non-numeric, unambiguous alternative', () => {
  const q = clue(100, "Czech Republic");
  const b: TriviaBoard = { categories: [{ name: "Europe", final: false, clues: [q, clue(200, "Slovakia")] }] };
  assert.equal(learnable(b, "Europe", q, "I think it's Czechia"), "czechia");
  assert.equal(learnable(b, "Europe", q, "the Czech Republic"), null, "already the answer");
  assert.equal(learnable(b, "Europe", q, "Slovakia"), null, "another clue's answer in the category");
  assert.equal(learnable(b, "Europe", q, "1968"), null, "numbers stay exact");
  assert.equal(learnable(b, "Europe", q, "no"), null, "too short");
  assert.equal(learnable(b, "Europe", q, "x".repeat(60)), null, "too long");
  assert.equal(learnable(b, "Europe", q, ""), null);
});

test('seeded: the same seed deals the same board; another day deals another', () => {
  const pool = { categories: [{ name: "P", final: false, clues: [100, 100, 100, 200, 200, 200].map((v, i) => ({ value: v, steps: [`c${i}`], answer: `a${i}`, also: [], asOf: null })) }] };
  const a = newTrivia(pool, new Set(), seeded("daily|2026-10-20")).deal;
  const b = newTrivia(pool, new Set(), seeded("daily|2026-10-20")).deal;
  assert.deepEqual(a, b);
  const days = Array.from({ length: 20 }, (_, i) => JSON.stringify(newTrivia(pool, new Set(), seeded(`daily|2026-11-${String(i + 1).padStart(2, "0")}`)).deal));
  assert.ok(new Set(days).size > 1, 'different days differ');
});

const clue = (value: number, answer: string) => ({ value, steps: [`Clue for ${answer}`], answer, also: [], asOf: null });
const cat = (name: string) => ({ name, final: false, clues: [100, 200, 300, 400, 500].map((v) => clue(v, `${name}${v}`)) });
const board: TriviaBoard = { categories: [cat("A"), cat("B"), cat("C"), cat("D"), cat("E"), cat("F"), { name: "Last", final: true, clues: [clue(1000, "Last1000")] }] };

test('sizeGame: minutes pick quick fire with a cap, a four-category board, or the whole board', () => {
  const st = newTrivia(board, new Set(), () => 0);
  const ten = sizeGame(board, st, 10);
  assert.match(ten.text, /SIZED FOR 10 MINUTES: quick fire of 12/);
  assert.equal(ten.state.mode, 'quick');
  assert.equal(ten.state.quickMax, 12);
  assert.match(ten.text, /QUESTION 1 of 12/);
  const fifteen = sizeGame(board, st, 15);
  assert.equal(fifteen.state.quickMax, 20);
  const twenty = sizeGame(board, st, 22, () => 0);
  assert.match(twenty.text, /four categories/);
  assert.equal(twenty.state.cats?.length, 4);
  assert.equal(dealtBoard(board, twenty.state).categories.length, 5, 'four categories plus the final');
  const whole = sizeGame(board, st, 40);
  assert.match(whole.text, /the whole board/);
  assert.equal(whole.state.cats, undefined);
  // "10 minutes" as a category word does the same from game_question.
  const viaWord = askQuestion(board, st, '10 minutes');
  assert.equal(viaWord.state.quickMax, 12);
});

test('a capped quick fire ends at its cap', () => {
  let st = sizeGame(board, newTrivia(board, new Set(), () => 0), 10).state;
  for (let i = 1; i <= 12; i++) {
    const a = answerQuestion(board, st, 'wrong', 'Sam');
    st = a.state;
    if (i < 12) assert.match(a.text, new RegExp(`QUESTION ${i + 1} of 12`));
    else assert.match(a.text, /the last of the 12/);
  }
  assert.equal(st.asked.length, 12);
});

test('streak: counts right answers and ends on the first miss', () => {
  const st0 = newTrivia(board, new Set(), () => 0);
  let st = askQuestion(board, st0, 'streak').state;
  assert.equal(st.mode, 'streak');
  for (let i = 1; i <= 3; i++) {
    const open = st.current!;
    const a = answerQuestion(board, st, `${open.cat}${open.value}`, 'Sam');
    assert.match(a.text, new RegExp(`STREAK: ${i} in a row`));
    st = a.state;
  }
  const miss = answerQuestion(board, st, 'wrong', 'Sam');
  assert.match(miss.text, /STREAK OVER at 3 in a row/);
  assert.equal(miss.state.streakOver, true);
  assert.equal(miss.state.current, null);
  const after = askQuestion(board, miss.state, 'next');
  assert.equal(after.error, true);
});

test('estimate: scored by closeness, needs a number, and cannot be challenged', () => {
  const q = { value: 200, steps: ["How tall is Everest, in metres?"], answer: "8,849", also: ["metres"], asOf: null, num: 8849 };
  const b: TriviaBoard = { categories: [{ name: "Heights", final: false, estimate: true, clues: [q] }, { name: "Other", final: false, clues: [clue(100, "x")] }] };
  const open = (): TriviaState => ({ ...askQuestion(b, newTrivia(b, new Set(), () => 0), "Heights", 200).state });
  const exact = answerQuestion(b, open(), "8849", "Sam");
  assert.match(exact.text, /^Ding! EXACTLY RIGHT\. It's 8849 metres; they said 8849\. Sam scores 200\./);
  const close = answerQuestion(b, open(), "about 9,000", "Sam");
  assert.match(close.text, /^Ding! NEAR|^Ding! VERY CLOSE/);
  assert.match(close.text, /Sam scores (200|100)\./);
  const near = answerQuestion(b, open(), "seven and a half thousand", "Sam");
  assert.match(near.text, /FAR OFF|NEAR/);
  const far = answerQuestion(b, open(), "twelve thousand", "Sam");
  assert.match(far.text, /^Bzzt\. FAR OFF\. It's 8849 metres; they said 12,000\. No points\./);
  assert.equal(far.state.last?.challenged, true, 'no challenge on an estimate');
  const nothing = answerQuestion(b, open(), "no idea", "Sam");
  assert.match(nothing.text, /needs a number/);
  assert.equal(nothing.state.current?.cat, "Heights", 'the clue stays open');
  assert.equal(nothing.error, undefined);
});

test('timelineView: labels from an allow-list, choices before the ending, the campaign recap', () => {
  const t0 = 1_000_000;
  const v = timelineView({ startedAt: t0, events: [
    { kind: 'ending', detail: 'The Long Walk', verdict: null, at: t0 + 90_000 },
    { kind: 'cue', detail: 'S3b', verdict: null, at: t0 + 30_000 },
    { kind: 'accusation', detail: 'Father Reyes', verdict: 'wrong', at: t0 + 40_000 },
    { kind: 'accusation', detail: 'Colleen', verdict: 'correct', at: t0 + 50_000 },
    { kind: 'reveal', detail: 'the whole solution text', verdict: null, at: t0 + 60_000 },
    { kind: 'passenger', detail: 'secret', verdict: null, at: t0 + 70_000 },
  ], path: ['Take the lantern', 'Wait in the dark'] });
  assert.deepEqual(v.events.map((e) => e.label), ['Started', 'Scene 3b reached', 'Accused Father Reyes: innocent', 'Accused Colleen: correct', 'The solution was revealed', 'Chose: "Take the lantern"', 'Chose: "Wait in the dark"', 'Ending: The Long Walk']);
  assert.equal(v.events[2].tone, 'warn'); assert.equal(v.events[3].tone, 'ok');
  assert.ok(!JSON.stringify(v).includes('secret') && !JSON.stringify(v).includes('solution text'), 'unknown kinds and reveal text are dropped');
  assert.equal(v.ended, true); assert.equal(v.summary, '2 choices so far');
  const w = timelineView({ startedAt: t0, events: [], world: { day: 3, location: 'The Salt Road', party: [{ name: 'Ana' }, { name: 'Rook' }], log: ['Day 1: a', 'Day 2: b', 'Day 3: c'], npcs: [{ name: 'Hidden Villain', status: 'x', note: 'is the traitor' }] } as never });
  assert.equal(w.summary, 'Day 3 · The Salt Road'); assert.equal(w.party, 'Party: Ana, Rook');
  assert.deepEqual(w.events.map((e) => e.label), ['Started', 'Day 1: a', 'Day 2: b', 'Day 3: c']);
  assert.ok(!JSON.stringify(w).includes('traitor') && !JSON.stringify(w).includes('Hidden Villain'), 'npcs never reach the view');
});

test('a sized game judges the clue the host was shown (2026-10-22: thesaurus read, preposition judged)', () => {
  // Six clues per slot, as on the real boards: only one is dealt per play.
  const poolCat = (name: string) => ({ name, final: false, clues: [100, 200, 300].flatMap((v) => [0, 1, 2, 3, 4, 5].map((k) => clue(v, `${name}${v}x${k}`))) });
  const pool: TriviaBoard = { categories: [poolCat("Words"), poolCat("Flags"), { name: "Last", final: true, clues: [clue(1000, "Last1000")] }] };
  const shownAnswer = (text: string) => /Clue for (\S+)/.exec(text)?.[1] ?? "";
  for (let i = 0; i < 60; i++) {
    // Up front: start_story with minutes passes the full board.
    const st0 = newTrivia(pool);
    const s1 = sizeGame(pool, st0, 10);
    const r1 = answerQuestion(dealtBoard(pool, s1.state), s1.state, shownAnswer(s1.text));
    assert.match(r1.text, /CORRECT/, `start_story path, round ${i}: ${s1.text}`);
    // Later: game_question "10 minutes" passes the dealt board.
    const st1 = newTrivia(pool);
    const s2 = askQuestion(dealtBoard(pool, st1), st1, "10 minutes");
    const r2 = answerQuestion(dealtBoard(pool, s2.state), s2.state, shownAnswer(s2.text));
    assert.match(r2.text, /CORRECT/, `game_question path, round ${i}`);
  }
});

test('majority: a challenge is settled once two judges agree, with the same outcome as waiting for all three', async () => {
  const { majority } = await import("../src/games.ts");
  const later = <T,>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  const never = new Promise<boolean | null>(() => {});
  // Two quick YES: upheld without waiting for the slow third.
  assert.deepEqual(await majority([later(true, 5), later(true, 10), never]), [true, true, null]);
  // Two quick NO: settled as not upheld.
  assert.deepEqual(await majority([later(false, 5), never, later(false, 10)]), [false, null, false]);
  // A NO and an abstain are two non-YES votes: it can't reach two YES.
  assert.deepEqual(await majority([later(null, 5), later(false, 10), never]), [null, false, null]);
  // Split 1-1: waits for the third.
  assert.deepEqual(await majority([later(true, 5), later(false, 10), later(true, 30)]), [true, false, true]);
  // A judge that throws counts as an abstain.
  assert.deepEqual(await majority([Promise.reject(new Error("x")), later(true, 5), later(true, 10)]), [null, true, true]);
  // Every possible set of three votes: settling early never changes the outcome.
  const vals = [true, false, null];
  for (const a of vals) for (const b of vals) for (const c of vals) {
    const full = [a, b, c].filter((v) => v === true).length >= 2;
    const early = (await majority([later(a, 1), later(b, 3), later(c, 6)])).filter((v) => v === true).length >= 2;
    assert.equal(early, full, `${a},${b},${c}`);
  }
});

test('quick fire shows no category or value on any screen (the category can hint at the answer)', async () => {
  const { watchView } = await import("../src/games.ts");
  const s = sizeGame(board, newTrivia(board), 10);
  const v = watchView(dealtBoard(board, s.state), s.state);
  assert.ok(v.open, "a question is open");
  assert.equal(v.open!.category, "");
  assert.equal(v.open!.value, null);
  const st = newTrivia(board);
  const q = askQuestion(dealtBoard(board, st), st, "A", 100);
  assert.equal(watchView(dealtBoard(board, q.state), q.state).open!.category, "A", "the board still names it");
});

test('no ties: a level final goes to a trivia-off with an undealt clue until one player wins', async () => {
  const { challenge } = await import("../src/games.ts");
  // Two clues per value, so a trivia-off has clues the play never dealt.
  const pc = (name: string) => ({ name, final: false, clues: [100, 200, 300].flatMap((v) => [0, 1].map((k) => clue(v, `${name}${v}x${k}`))) });
  const pool: TriviaBoard = { categories: [pc("A"), pc("B"), { name: "Last", final: true, clues: [clue(1000, "Last1000")] }] };
  let st: TriviaState = newTrivia(pool);
  const dealt = () => dealtBoard(pool, st);
  st = { ...st, asked: dealt().categories.filter((c) => !c.final).flatMap((c) => c.clues.map((q) => `${c.name.toLowerCase()}|${q.value}`)), scores: { Sam: 300, Riley: 300 } };
  st = askQuestion(dealt(), st, "final").state;
  st = answerQuestion(dealt(), st, "no idea", "Sam", pool).state;
  const end = answerQuestion(dealt(), st, "no idea", "Riley", pool);
  assert.match(end.text, /IT'S A TIE: Sam and Riley on 300/);
  assert.match(end.text, /TRIVIA-OFF QUESTION 1/);
  st = end.state;
  assert.ok(st.tie, "a trivia-off is on");
  const t = st.tie!;
  const tq = pool.categories.find((c) => c.name === t.cat)!.clues[t.idx];
  assert.notEqual(st.deal![`${t.cat.toLowerCase()}|${tq.value}`], t.idx, "the trivia-off clue was never dealt");
  // Only the tied players answer; the answer waits until both have.
  assert.equal(answerQuestion(dealt(), st, "x", "Alex", pool).error, true);
  const one = answerQuestion(dealt(), st, "wrong", "Sam", pool);
  assert.doesNotMatch(one.text, new RegExp(tq.answer), "the answer is not said yet");
  st = one.state;
  assert.equal((await challenge(undefined, dealt(), st)).error, true, "no challenges in a trivia-off");
  // Both wrong: another question, both still in.
  const r1 = answerQuestion(dealt(), st, "wrong", "Riley", pool);
  assert.match(r1.text, /TRIVIA-OFF QUESTION 2/);
  st = r1.state;
  // Sam right, Riley wrong: Sam wins.
  const t2 = st.tie!;
  const a2 = pool.categories.find((c) => c.name === t2.cat)!.clues[t2.idx].answer;
  st = answerQuestion(dealt(), st, a2, "Sam", pool).state;
  const win = answerQuestion(dealt(), st, "nope", "Riley", pool);
  assert.match(win.text, /Sam WINS THE TRIVIA-OFF/);
  assert.equal(win.state.tieWinner, "Sam");
  assert.equal(win.state.tie, undefined);
});

test('an estimate cannot be challenged, and says why', async () => {
  const { challenge } = await import("../src/games.ts");
  const q = { value: 100, steps: ["How tall?"], answer: "100", also: ["metres"], asOf: null, num: 100 };
  const b: TriviaBoard = { categories: [{ name: "Heights", final: false, estimate: true, clues: [q] }] };
  let st = newTrivia(b);
  st = askQuestion(b, st, "Heights", 100).state;
  st = answerQuestion(b, st, "5", "Sam").state;
  const r = await challenge(undefined, b, st);
  assert.equal(r.error, true);
  assert.match(r.text, /Estimates can't be challenged/);
});
