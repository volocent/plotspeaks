import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-story.mjs');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

function withStory(slug, files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'check-story-'));
  const dir = join(root, slug);
  mkdirSync(dir);
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  try { return fn(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('cli: missing story.md and missing secrets.md exit 1', () => {
  withStory('empty', {}, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ERROR story\.md:1 front-matter/);
    assert.match(r.stdout, /empty: 1 errors, 0 warnings/);
  });
  withStory('nosecrets', { 'story.md': '---\nname: x\n---\n' }, (dir) => {
    const r = run(dir);
    assert.match(r.stdout, /ERROR secrets\.md:1 secrets — secrets\.md is missing/);
  });
});

test('cli: --json is parseable and CRLF input is handled', () => {
  const story = ['---', 'name: plotspeaks-crlf', 'description: d', 'license: CC-BY-4.0', 'metadata:', '  title: T', '  genre: heist', '  duration_minutes: 30', '  chapters: 1', '  players: 2', '  rating: G', '  version: 1.0.0', '  author: a', '  voice_ready: false', '  rules_system: none', '  ai_disclosure: ai-assisted', '---', ''].join('\r\n');
  withStory('crlf', { 'story.md': story, 'secrets.md': '# s\r\n' }, (dir) => {
    const r = run('--json', dir);
    const data = JSON.parse(r.stdout);
    assert.equal(data[0].slug, 'crlf');
    assert.ok(!data[0].findings.some((f) => f.rule === 'front-matter'));
    assert.ok(data[0].findings.some((f) => f.rule === 'required-sections'));
  });
});
