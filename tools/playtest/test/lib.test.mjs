import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  parseEndings, findEnding, followupIds, wranglerBrief, parseCueChoice, parseAccusation, extractCue, parseJudgeJson, wranglerCheckRequested, wranglerCueId, pregenNames,
} from '../lib.mjs';

const fx = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'secrets-fixture.md'), 'utf8');

test('parseEndings reads only the Endings detail section', () => {
  const e = parseEndings(fx);
  assert.deepEqual(e.map((x) => [x.name, x.verdict]), [
    ['Ada Quill', 'correct'], ['Bram Holt', 'wrong'], ['Keeper Cora Vane', 'wrong'], ['Dov Rook', 'wrong']]);
  assert.match(e[0].text, /^Ada goes very still/);
});

test('findEnding matches first, last or full name, ignoring titles', () => {
  const e = parseEndings(fx);
  assert.equal(findEnding(e, 'Ada Quill').name, 'Ada Quill');
  assert.equal(findEnding(e, 'ada').name, 'Ada Quill');
  assert.equal(findEnding(e, 'Vane').name, 'Keeper Cora Vane');
  assert.equal(findEnding(e, 'Keeper Cora Vane').name, 'Keeper Cora Vane');
  assert.equal(findEnding(e, 'Rook').name, 'Dov Rook');
  assert.equal(findEnding(e, 'Nobody Here'), null);
  assert.equal(findEnding(e, null), null);
});

test('parseAccusation handles a name said before "I accuse you"', () => {
  assert.equal(parseAccusation('Let\'s try again. Bram Holt, I accuse you: you went through the back door.'), 'Bram Holt');
  assert.equal(parseAccusation('I accuse you!'), null);
});

test('parseAccusation extracts the name', () => {
  assert.equal(parseAccusation('I accuse Ada Quill because she came in from the fog.'), 'Ada Quill');
  assert.equal(parseAccusation('I accuse Mr. Bram. He lied about the tides.'), 'Mr Bram');
  const mixed = [{ name: 'Bram Holt', verdict: 'wrong', text: 'b' }, { name: 'Ada Quill', verdict: 'wrong', text: 'a' }];
  assert.equal(findEnding(mixed, 'Ada Holt').name, 'Ada Quill');
  assert.equal(parseAccusation('Okay. I accuse Keeper Vane.'), 'Keeper Vane');
  assert.equal(parseAccusation('i accuse the butler, he did it'), 'butler');
  assert.equal(parseAccusation('I think it was June'), null);
});

test('extractCue returns the read-aloud part, plus numbers, never the wrangler-only part', () => {
  const c1 = extractCue(fx, '1');
  assert.equal(c1, 'This automaton never moves; it is only brass at rest.');
  const c2 = extractCue(fx, '2');
  assert.match(c2, /^The cabinet is a brass automaton\.\nBrass automaton, AC 12\. HP 30\.$/);
  for (const c of [c1, c2]) assert.doesNotMatch(c, /SECRET-WRANGLER-ONLY/);
  assert.equal(extractCue(fx, '9'), null);
});

test('parseCueChoice holds a follow-up until its main cue has been called', () => {
  assert.equal(parseCueChoice('S2b', ['1b', '2b'], [], new Set()), null);
  assert.equal(parseCueChoice('S2b', ['1b', '2b'], [], new Set(['1'])), null);
  assert.equal(parseCueChoice('S2b', ['1b', '2b'], [], new Set(['2'])), '2b');
  assert.equal(parseCueChoice('S2b', ['1b', '2b'], []), '2b'); // no main-cue list given: old behaviour
});

test('extractCue keeps a split cue\'s later read-aloud beats, in order', () => {
  const md = '## S1 — Split\n\n**When:** x.\n\n**Read aloud to the narrator:** "Beat one."\n\n' +
    '**Read aloud (to the narrator, beat 2/2):** "Beat two."\n\n**Wrangler only (don\'t read):** SECRET-WRANGLER-ONLY\n';
  assert.equal(extractCue(md, '1'), 'Beat one.\nBeat two.');
});

test('wrangler trigger detection', () => {
  assert.ok(wranglerCheckRequested('Very well. Wrangler, check the secrets.'));
  assert.ok(wranglerCheckRequested('WRANGLER CHECK THE SECRETS'));
  assert.ok(!wranglerCheckRequested('The wrangler is busy.'));
  assert.equal(wranglerCueId('Wrangler, cue S2c.'), '2c');
  assert.equal(wranglerCueId('Wrangler, cue S3'), '3');
  assert.equal(wranglerCueId('nothing'), null);
});

test('parseJudgeJson handles fences, prose and bad input', () => {
  assert.deepEqual(parseJudgeJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJudgeJson('```json\n{"a":{"b":"}"}}\n```'), { a: { b: '}' } });
  assert.deepEqual(parseJudgeJson('Here you go: {"a":[1,2]} hope that helps'), { a: [1, 2] });
  assert.equal(parseJudgeJson('no json here'), null);
  assert.equal(parseJudgeJson('{"a":'), null);
  assert.equal(parseJudgeJson(''), null);
});

test('pregenNames', () => {
  const md = '## Pregenerated characters (all level 3)\n\nIntro.\n\n- **Tilda Marsh** — Human\n- **Joss Penhallow** — Halfling\n\n## Setting\n- **Not me** x';
  assert.deepEqual(pregenNames(md), ['Tilda Marsh', 'Joss Penhallow']);
});

test('parseCueChoice accepts only valid, uncalled follow-up ids', () => {
  const valid = ['3b', '3c', '2c'];
  assert.equal(parseCueChoice('S3b', valid), '3b');
  assert.equal(parseCueChoice('I would call cue s3B now.', valid), '3b');
  assert.equal(parseCueChoice('NONE', valid), null);
  assert.equal(parseCueChoice('S9z', valid), null);
  assert.equal(parseCueChoice('S3b', valid, ['3b']), null);
  assert.equal(parseCueChoice('S3b or S3c', valid, ['3b']), '3c');
  assert.equal(parseCueChoice('', valid), null);
});

test('followupIds and wranglerBrief never leak read-aloud text', () => {
  const md = '### Listen for\n\n| a | b |\n\n## S1 — One\n\n**Read aloud to the narrator:** "SAFE1"\n\n**Wrangler only (dont read):** note one\n\n## S1b — Two\n\n**Read aloud to the narrator:** "SAFE2"\n\n**Wrangler only (dont read):** note two\n';
  assert.deepEqual(followupIds(md).map((f) => f.id), ['1b']);
  const b = wranglerBrief(md);
  assert.match(b.wranglerOnly, /note one/);
  assert.match(b.wranglerOnly, /note two/);
  assert.doesNotMatch(b.wranglerOnly + b.listenFor, /SAFE/);
  assert.match(b.listenFor, /a | b/);
});
