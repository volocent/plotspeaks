// Builds the passenger's answer-key page from every stories/<slug>/secrets.md.
// Output goes to dist/ (gitignored) because the page contains the solutions.
// Usage: node tools/wrangler-console/build.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const storiesDir = join(root, 'stories');

const field = (fm, key) => {
  const m = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(fm);
  return m ? m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : '';
};

const stories = [];
for (const slug of readdirSync(storiesDir).sort()) {
  const storyPath = join(storiesDir, slug, 'story.md');
  const secretsPath = join(storiesDir, slug, 'secrets.md');
  if (!existsSync(storyPath) || !existsSync(secretsPath)) continue;
  const story = readFileSync(storyPath, 'utf8').replace(/\r\n/g, '\n');
  const fm = (/^---\n([\s\S]*?)\n---/.exec(story) || [, ''])[1];
  stories.push({
    slug,
    title: field(fm, 'title') || slug,
    genre: field(fm, 'genre'),
    secrets: readFileSync(secretsPath, 'utf8').replace(/\r\n/g, '\n'),
  });
}
if (!stories.length) throw new Error('no stories with both story.md and secrets.md');

// Order: mysteries first (lead genre), then the rest.
stories.sort((a, b) => (a.genre === 'murder-mystery' ? 0 : 1) - (b.genre === 'murder-mystery' ? 0 : 1));

const template = readFileSync(join(root, 'tools', 'wrangler-console', 'template.html'), 'utf8');
const data = JSON.stringify(stories).replace(/</g, '\\u003c');
if (!template.includes('/*__DATA__*/null')) throw new Error('template is missing the data placeholder');
const html = template.replace('/*__DATA__*/null', data);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'wrangler-console.html');
writeFileSync(out, html);
console.log(`wrote ${out} with ${stories.length} stories: ${stories.map((s) => s.title).join(', ')}`);
