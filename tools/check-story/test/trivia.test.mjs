import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrivia, answerMatches, normAnswer, checkTrivia } from '../trivia.mjs';

const board = [
  '## Category Space',
  '| Value | Clue | Answer | Also accept | As of |',
  '|---|---|---|---|---|',
  '| 100 | The planet named for the Roman god of war. | Mars | the red planet | |',
  '| 200 | She won Nobel Prizes in physics and chemistry. | Marie Curie | Madame Curie | |',
  '| 300 | A film: a toy cowboy // a space ranger arrives // to infinity | Toy Story | | |',
  '## Category Numbers',
  '| Value | Clue | Answer | Also accept | As of |',
  '|---|---|---|---|---|',
  '| 100 | Sides on a hexagon. | 6 | six | |',
  '## Category Rivers',
  '| Value | Clue | Answer | Also accept | As of |',
  '|---|---|---|---|---|',
  '| 100 | The river through Cairo. | Nile | | |',
  '## Final Space',
  '| Value | Clue | Answer | Also accept | As of |',
  '|---|---|---|---|---|',
  '| 1000 | The largest planet. | Jupiter | | |',
].join('\n');

test('parseTrivia reads categories, values, steps, alternatives and the final', () => {
  const t = parseTrivia(board);
  assert.deepEqual(t.categories.map((c) => [c.name, c.final, c.clues.length]), [['Space', false, 3], ['Numbers', false, 1], ['Rivers', false, 1], ['Space', true, 1]]);
  assert.deepEqual(t.categories[0].clues[2].steps, ['A film: a toy cowboy', 'a space ranger arrives', 'to infinity']);
  assert.deepEqual(t.categories[0].clues[0].also, ['the red planet']);
});

test('answerMatches: articles, "what is", spelling slips, surnames, alternatives; never fuzzy on numbers', () => {
  const [mars, curie] = parseTrivia(board).categories[0].clues;
  const six = parseTrivia(board).categories[1].clues[0];
  assert.equal(normAnswer('What is the Red Planet?'), 'red planet');
  for (const s of ['Mars', 'mars!', 'What is Mars', 'the red planet']) assert.equal(answerMatches(s, mars), true, s);
  // Keys under five letters are exact: one slip in "Mars" is "Mark" or "Mare", a different answer.
  for (const s of ['Venus', 'Mercury', 'Marz', '']) assert.equal(answerMatches(s, mars), false, s);
  assert.equal(answerMatches('Jupitar', parseTrivia(board).categories[3].clues[0]), true);
  for (const s of ['Curie', 'Marie Curie', 'Madame Curie', 'Marie Currie']) assert.equal(answerMatches(s, curie), true, s);
  assert.equal(answerMatches('Pierre', curie), false);
  assert.equal(answerMatches('six', six), true);
  assert.equal(answerMatches('7', six), false);
});

test('checkTrivia: a board passes; duplicate values, missing answers and self-answering clues fail', () => {
  assert.deepEqual(checkTrivia(board).filter((f) => f.severity === 'ERROR'), []);
  const bad = board.replace('| 200 | She won', '| 100 | She won').replace('| Nile |', '|  |').replace('Sides on a hexagon.', 'Six sides on a hexagon.');
  const msgs = checkTrivia(bad).map((f) => f.message).join('\n');
  assert.match(msgs, /"Space" has two 100 clues/);
  assert.match(msgs, /has no answer/);
  assert.match(checkTrivia('nothing').map((f) => f.message).join(), /needs "## Category/);
});
