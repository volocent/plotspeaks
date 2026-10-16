// Rule `full-reveal` and the read-aloud exemption for the `## Full reveal` section (review 2026-10-16, B3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFullReveal, checkReadAloud } from '../rules.mjs';
import { parseFullReveal } from '../../playtest/lib.mjs';

const REVEAL = [
  '# Demo secrets', '',
  '## Endings detail', '', '- **Ada (correct):** Correct. She did it.', '',
  '## Full reveal', '',
  '**Read aloud:** It was Ada. She wanted the house.', '',
  'The muddy boots, the cold car and the missing page all pointed to her. Bram only lied to protect his sister. Nobody else was near the study.', '',
  '**What became of them:**',
  '- Ada: She was charged the next morning.',
  '- Bram: He sold the mill.', '',
].join('\n');

test('full-reveal: a complete section passes; a mystery without one warns; adventures are skipped', () => {
  assert.deepEqual(checkFullReveal(REVEAL, { genre: 'murder-mystery' }), []);
  const missing = checkFullReveal('# s\n\n## Endings detail\n', { genre: 'kids' });
  assert.deepEqual(missing.map((f) => [f.severity, f.rule]), [['WARN', 'full-reveal']]);
  assert.deepEqual(checkFullReveal('# s', { genre: 'adventure' }), []);
});

test('full-reveal: missing parts, too long, and markdown inside warn', () => {
  const noAfter = REVEAL.split('**What became of them:**')[0];
  assert.ok(checkFullReveal(noAfter, { genre: 'murder-mystery' }).some((f) => /What became of them/.test(f.message)));
  const long = REVEAL.replace('It was Ada.', `It was Ada. ${'word '.repeat(170)}`);
  assert.ok(checkFullReveal(long, { genre: 'murder-mystery' }).some((f) => /160 at most/.test(f.message)));
  const md = REVEAL.replace('She wanted the house.', 'She wanted **the house**.');
  assert.ok(checkFullReveal(md, { genre: 'murder-mystery' }).some((f) => /plain prose/.test(f.message)));
  assert.ok(checkFullReveal(REVEAL.replace(/^- .*$/gm, ''), { genre: 'murder-mystery' }).some((f) => /bullets/.test(f.message)));
});

test('read-aloud: the Full reveal section is exempt from the sentence and length rules', () => {
  // Four sentences in the second paragraph, and a first paragraph of two: would error/warn elsewhere.
  assert.deepEqual(checkReadAloud(REVEAL).filter((f) => f.rule.startsWith('read-aloud')), []);
  const elsewhere = '## S1\n\n**Read aloud:** One. Two. Three. Four.\n';
  assert.deepEqual(checkReadAloud(`${REVEAL}\n${elsewhere}`).map((f) => f.rule), ['read-aloud']);
});

test('parseFullReveal: both paragraphs, then the bullets; null without the section', () => {
  const r = parseFullReveal(REVEAL);
  assert.match(r.read_aloud, /^It was Ada\. She wanted the house\.\n\nThe muddy boots/);
  assert.doesNotMatch(r.read_aloud, /What became/);
  assert.equal(r.afterward, '- Ada: She was charged the next morning.\n- Bram: He sold the mill.');
  assert.equal(parseFullReveal('# s\n## Endings detail\n'), null);
  assert.equal(parseFullReveal(REVEAL.replace(/\r?\n/g, '\r\n')).afterward.split('\n').length, 2);
});
