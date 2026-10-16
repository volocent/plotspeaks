import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { buildSolo, SOLO_SECTION, SECRETS_HEADING } from '../build.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const story = readFileSync(join(dir, 'story-fixture.md'), 'utf8');
const secrets = readFileSync(join(dir, 'secrets-fixture.md'), 'utf8');
const out = buildSolo(story, secrets);

test('front matter name gets -solo and description is prefixed', () => {
  assert.match(out, /^---\nname: plotspeaks-test-story-solo\n/);
  assert.match(out, /\ndescription: Solo mode: Run "Test Story", a short mystery\.\n/);
  assert.match(out, /\nlicense: CC-BY-NC-4\.0\n/);
});

test('solo section sits after the front matter and before the title', () => {
  const sec = out.indexOf('## Solo mode (no passenger)');
  assert.ok(sec > 0);
  assert.ok(out.includes(SOLO_SECTION));
  assert.ok(out.indexOf('\n---\n') < sec);
  assert.ok(sec < out.indexOf('# Test Story'));
});

test('story body is unchanged and secrets follow after a --- line', () => {
  assert.ok(out.includes('Say hello. When accused, say "Wrangler, check the secrets."'));
  const hr = out.lastIndexOf('\n---\n\n' + SECRETS_HEADING);
  assert.ok(hr > out.indexOf('Say hello'));
  assert.ok(out.slice(hr).includes('- Ada Quill: she did it.'));
  assert.ok(out.endsWith('\n') && !out.endsWith('\n\n'));
});

test('CRLF input is handled and missing front matter throws', () => {
  assert.match(buildSolo(story.replace(/\n/g, '\r\n'), secrets), /^---\nname: plotspeaks-test-story-solo\n/);
  assert.throws(() => buildSolo('# no front matter', secrets));
});
