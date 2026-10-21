// The trivia engine (worker/src/games.ts) off the server: sizing a game to a drive, and a streak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrivia, dealtBoard, sizeGame, askQuestion, answerQuestion, seeded, learnable, type TriviaBoard, type TriviaState } from "../src/games.ts";

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
