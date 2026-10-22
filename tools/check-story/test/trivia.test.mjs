import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrivia, answerMatches, normAnswer, checkTrivia, altMatch, parseSpokenNumber, estimateBand } from '../trivia.mjs';

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
  // Review 2026-10-17: a real word one letter off is a different answer, and the surname rule is
  // only for clues about a person.
  const place = (answer, clue) => ({ answer, also: [], steps: [clue] });
  assert.equal(answerMatches('Iceland', place('Ireland', 'This island country is home to Dublin.')), false);
  assert.equal(answerMatches('hungry', place('Hungary', 'Budapest is its capital.')), false);
  assert.equal(answerMatches('Virginia', place('West Virginia', 'Charleston is the capital of this state.')), false);
  assert.equal(answerMatches('Island', place('Rhode Island', 'The smallest US state.')), false);
  assert.equal(answerMatches('Mississipi', place('Mississippi', 'The river that flows past New Orleans.')), true);
  assert.equal(answerMatches('six', six), true);
  assert.equal(answerMatches('7', six), false);
});

test('checkTrivia: a board passes; duplicate values, missing answers and self-answering clues fail', () => {
  assert.deepEqual(checkTrivia(board).filter((f) => f.severity === 'ERROR'), []);
  const bad = board.replace('| 200 | She won', '| 100 | She won').replace('| Nile |', '|  |').replace('Sides on a hexagon.', 'Six sides on a hexagon.');
  const msgs = checkTrivia(bad).map((f) => f.message).join('\n');
  assert.match(msgs, /"Space" has no 200 clue/);
  // A pool (two clues at one value) is fine; two clues with the same answer in a category are not.
  const pool = board.replace('| 300 | A film:', '| 100 | The red planet again, by another clue. | Mars | | |\n| 300 | A film:');
  assert.match(checkTrivia(pool).map((f) => f.message).join('\n'), /two clues with the answer "Mars"/);
  const pool2 = board.replace('| 300 | A film:', '| 100 | The planet with the Great Red Spot. | Jupiter | | |\n| 300 | A film:');
  assert.deepEqual(checkTrivia(pool2).filter((f) => f.severity === 'ERROR'), []);
  assert.match(msgs, /has no answer/);
  assert.match(checkTrivia('nothing').map((f) => f.message).join(), /needs "## Category/);
});

// Julia's play (2026-10-19): "Czechia" counts for "Czech Republic", and the host is told it was another name.
test('altMatch: another accepted name is reported; the main answer and slips are not', () => {
  const cz = { answer: 'Czech Republic', also: ['Czechia', 'the Czech Republic'], steps: ['A central European country, capital Prague.'] };
  assert.equal(answerMatches('Czechia', cz), true);
  assert.equal(altMatch('Czechia', cz), 'Czechia');
  assert.equal(altMatch('I think it is Czechia', cz), 'Czechia');
  assert.equal(altMatch('Czech Republic', cz), null);
  assert.equal(altMatch('the Czech Republic', cz), null);
  assert.equal(altMatch('Slovakia', cz), null);
});

// Estimate questions (plan 2026-10-19, item 3): the first number in a spoken answer, scored by closeness.
test('parseSpokenNumber: digits, words, scales, decimals and hedges', () => {
  const cases = [
    ['8849', 8849], ['8,849 metres', 8849], ['about 1.5 million', 1500000], ['5k', 5000], ['around 3 thousand', 3000],
    ['twelve hundred', 1200], ['a hundred and fifty', 150], ['two thousand and four', 2004], ['nineteen sixty eight', 1968], ['twenty twenty four', 2024], ['one hundred twenty', 120],
    ['three point five', 3.5], ['forty two', 42], ['one hundred twenty three', 123], ['seven billion', 7e9],    ['I think it is about 384,400 kilometres', 384400], ['minus ten', -10], ['no idea', null], ['', null],
  ];
  for (const [said, want] of cases) assert.equal(parseSpokenNumber(said), want, said);
});

test('estimateBand: exact, close within 5%, near within 15%, otherwise far', () => {
  assert.equal(estimateBand(100, 100), 'exact');
  assert.equal(estimateBand(104, 100), 'close');
  assert.equal(estimateBand(86, 100), 'near');
  assert.equal(estimateBand(50, 100), 'far');
  assert.equal(estimateBand(5, 0), 'far');
});

test('an estimate category parses with numeric answers and lints', () => {
  const text = ['## Estimate Heights', '| Value | Clue | Answer | Also accept | As of |', '|---|---|---|---|---|', '| 100 | How tall is Everest, in metres? | 8,849 | metres | 2020 |', '| 200 | How tall is the Eiffel Tower, in metres? | tall | metres | |'].join('\n');
  const t = parseTrivia(text);
  assert.equal(t.categories[0].estimate, true);
  assert.equal(t.categories[0].clues[0].num, 8849);
  const msgs = checkTrivia(text).filter((f) => f.severity === 'ERROR').map((f) => f.message).join('\n');
  assert.match(msgs, /needs a number as its answer/);
});

test('a numeric final is an estimate only on a board that has estimate categories', () => {
  const head = ['| Value | Clue | Answer | Also accept | As of |', '|---|---|---|---|---|'];
  const final = ['## Final Year', ...head, '| 1000 | In what year did it happen? | 1066 | | |'];
  const withEst = parseTrivia(['## Estimate Heights', ...head, '| 100 | How tall? | 10 | metres | |', ...final].join('\n'));
  assert.equal(withEst.categories[1].estimate, true);
  assert.equal(withEst.categories[1].clues[0].num, 1066);
  const plain = parseTrivia(['## Category Dates', ...head, '| 100 | Which year? | 1492 | | |', ...final].join('\n'));
  assert.equal(plain.categories[1].estimate, false);
});

test('normAnswer: "Mt." and "Mount", and "&" and "and", compare equal', () => {
  assert.equal(normAnswer('Mt. Everest'), normAnswer('Mount Everest'));
  assert.equal(normAnswer('Moose & Juice'), normAnswer('Moose and Juice'));
});
