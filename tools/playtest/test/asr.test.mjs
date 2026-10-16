import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRng, asrNoise, castNames, nameVariants, BRAND_VARIANTS } from '../lib.mjs';

const CAST = '## Cast (public)\n\n| Name | Role |\n|---|---|\n| Orla Venn (victim) | Captain |\n| Dov Fairbourne | Cook |\n| Keeper Cora Whitehaven | Keeper |\n\n## Next\n';
const rngOf = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

test('seededRng is deterministic per seed', () => {
  const a = seededRng('x'), b = seededRng('x'), c = seededRng('y');
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((n) => n >= 0 && n < 1));
});

test('castNames takes capitalised words from the first column and drops parentheticals', () => {
  assert.deepEqual(castNames(CAST), [['Orla', 'Venn'], ['Dov', 'Fairbourne'], ['Keeper', 'Cora', 'Whitehaven']]);
});

test('nameVariants mangles sound-alikes and never returns the original', () => {
  assert.ok(nameVariants('Whitehaven').includes('white haven'));
  assert.ok(nameVariants('Fairbourne').includes('fairborn'));
  assert.ok(nameVariants('Keeper').includes('keaper'));
  assert.ok(nameVariants('Quill').includes('quil'));
  assert.ok(nameVariants('Keeper').includes('ceeper'));
  for (const n of ['Venn', 'Vane', 'Cora', 'Quill']) assert.ok(nameVariants(n).every((x) => x !== n.toLowerCase()));
});

test('always: punctuation stripped except apostrophes, lowercased', () => {
  const rng = rngOf([0.99]); // no roll ever triggers
  assert.equal(asrNoise('Plot Speaks, pause the story.', 'low', rng), 'plot speaks pause the story');
  assert.equal(asrNoise("Don't worry -- I'm fine!", 'high', rng), "don't worry i'm fine");
});

test('brand variants chosen from the list only when the roll is under the level probability', () => {
  const out = asrNoise('Plot Speaks, resume.', 'high', rngOf([0, 0, 0.99]));
  assert.ok(BRAND_VARIANTS.slice(1).some((b) => out === `${b} resume`), out);
  assert.equal(asrNoise('Plot Speaks, resume.', 'low', rngOf([0.5])), 'plot speaks resume');
  // 0.4 is under high (0.6) but over low (0.3)
  assert.notEqual(asrNoise('Plot Speaks', 'high', rngOf([0.4, 0])), 'plot speaks');
  assert.equal(asrNoise('Plot Speaks', 'low', rngOf([0.4, 0])), 'plot speaks');
});

test('names are mangled or reduced to first name at the level probability', () => {
  const names = castNames(CAST);
  const out = asrNoise('I accuse Dov Fairbourne', 'high', rngOf([0.99, 0.99, 0, 0, 0.99]), names);
  assert.match(out, /^i accuse /);
  assert.notEqual(out, 'i accuse dov fairbourne');
  assert.equal(asrNoise('I accuse Dov Fairbourne', 'high', rngOf([0.99]), names), 'i accuse dov fairbourne');
  // first-name-only: roll under prob, then pick the last option (drop surname)
  const first = asrNoise('Dov Fairbourne', 'high', rngOf([0, 0.999]), names);
  assert.equal(first, 'dov');
});

test('homophone swaps and drops', () => {
  const swapped = asrNoise('to', 'high', rngOf([0, 0, 0]));
  assert.ok(['two', 'too'].includes(swapped), swapped);
  assert.equal(asrNoise('to', 'high', rngOf([0, 0.99])), ''); // dropped
  assert.equal(asrNoise('hello', 'high', rngOf([0, 0.99])), 'hello'); // non-homophone word: kept when the drop roll fails
});

test('deterministic for a given seed; unknown level is a no-op', () => {
  const names = castNames(CAST);
  const line = 'Plot Speaks, I accuse Dov Fairbourne because he was there to hear the whole thing, right?';
  assert.equal(asrNoise(line, 'high', seededRng('s'), names), asrNoise(line, 'high', seededRng('s'), names));
  assert.equal(asrNoise(line, 'off', seededRng('s'), names), line);
});
