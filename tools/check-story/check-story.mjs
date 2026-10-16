#!/usr/bin/env node
// check-story CLI: file and git layer around the pure checks in rules.mjs.
// Usage: node tools/check-story/check-story.mjs [--json] [stories/<slug> ...]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStoryText, checkAudioCues, checkDenylist, checkWranglerCues, checkCueParts, checkReadAloud, checkCulpritTells, checkFullReveal, parseFrontMatter, parseDenylist } from './rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** Rule `secrets`: secrets.md must exist, be untracked and be gitignored. Returns findings. */
function checkSecretsFile(storyDir) {
  const path = join(storyDir, 'secrets.md');
  if (!existsSync(path)) return [{ severity: 'ERROR', file: 'secrets.md', line: 1, rule: 'secrets', message: 'secrets.md is missing next to story.md' }];
  const inside = git(storyDir, ['rev-parse', '--is-inside-work-tree']);
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== 'true') {
    return [{ severity: 'WARN', file: 'secrets.md', line: 1, rule: 'secrets', message: 'not in a git repo (or git unavailable): cannot verify secrets.md is untracked and gitignored' }];
  }
  const out = [];
  if (git(storyDir, ['ls-files', '--error-unmatch', 'secrets.md']).status === 0) {
    out.push({ severity: 'ERROR', file: 'secrets.md', line: 1, rule: 'secrets', message: 'secrets.md is tracked by git' });
  }
  if (git(storyDir, ['check-ignore', '-q', 'secrets.md']).status !== 0) {
    out.push({ severity: 'ERROR', file: 'secrets.md', line: 1, rule: 'secrets', message: 'secrets.md is not gitignored' });
  }
  return out;
}

/** Checks one story folder. Returns { slug, dir, findings, errors, warnings }. */
export function checkStoryDir(dir, denylist) {
  const slug = basename(resolve(dir));
  const findings = [];
  const storyPath = join(dir, 'story.md');
  if (!existsSync(storyPath)) {
    findings.push({ severity: 'ERROR', file: 'story.md', line: 1, rule: 'front-matter', message: 'story.md not found' });
  } else {
    const story = readFileSync(storyPath, 'utf8');
    const secretsPath = join(dir, 'secrets.md');
    const secrets = existsSync(secretsPath) ? readFileSync(secretsPath, 'utf8') : '';
    for (const f of checkStoryText(story, { slug, denylist })) findings.push({ file: 'story.md', ...f });
    findings.push(...checkSecretsFile(dir));
    if (secrets) {
      for (const f of [...checkAudioCues(secrets), ...checkDenylist(secrets, denylist), ...checkReadAloud(secrets)]) findings.push({ file: 'secrets.md', ...f });
    }
    for (const f of checkWranglerCues(story, secrets)) findings.push({ ...f });
    for (const f of checkCueParts(secrets)) findings.push({ ...f });
    for (const f of checkCulpritTells(story, secrets)) findings.push({ file: 'story.md', ...f });
    const fm = parseFrontMatter(story);
    if (secrets && fm.ok) findings.push(...checkFullReveal(secrets, { genre: fm.metadata.genre }));
  }
  const errors = findings.filter((f) => f.severity === 'ERROR').length;
  const warnings = findings.filter((f) => f.severity === 'WARN').length;
  return { slug, dir, findings, errors, warnings };
}

function main(argv) {
  const json = argv.includes('--json');
  let targets = argv.filter((a) => !a.startsWith('--'));
  if (targets.length === 0) {
    const root = join(repoRoot, 'stories');
    targets = existsSync(root)
      ? readdirSync(root).map((n) => join(root, n)).filter((p) => statSync(p).isDirectory())
      : [];
  }
  const denylist = parseDenylist(readFileSync(join(here, 'denylist.txt'), 'utf8'));
  const results = targets.map((t) => checkStoryDir(resolve(t), denylist));
  if (json) {
    console.log(JSON.stringify(results.map(({ dir, ...r }) => r), null, 2));
  } else {
    for (const r of results) {
      console.log(`== ${r.slug} ==`);
      for (const f of r.findings) console.log(`${f.severity} ${f.file}:${f.line} ${f.rule} — ${f.message}`);
      console.log(`${r.slug}: ${r.errors} errors, ${r.warnings} warnings`);
    }
    if (results.length === 0) console.log('no stories found');
  }
  return results.some((r) => r.errors > 0) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
