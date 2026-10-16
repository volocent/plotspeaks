// Builds a private phone page with one "Copy" button per story version, so a story can be
// pasted straight into a ChatGPT or Claude chat. Why: on 2026-10-15 ChatGPT voice (free plan)
// ignored a story attached to a Project and improvised instead; pasting puts the story in the
// chat history, which voice does see. Output is in dist/ (gitignored): the solo texts hold the answers.
// Usage: node tools/solo/build.mjs && node tools/story-loader/build.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRIMER = 'Below is a Plot Speaks story script. Read all of it now and follow its GM instructions for the rest of this chat. Don\'t start the story yet: reply only with the story\'s title, then wait until I say "Plot Speaks, start the story."\n\n';

const items = [];
for (const slug of readdirSync(join(root, 'stories')).sort()) {
  const story = join(root, 'stories', slug, 'story.md');
  if (!existsSync(story)) continue;
  const text = readFileSync(story, 'utf8').replace(/\r\n/g, '\n');
  const title = (/^\s*title:\s*(.+)$/m.exec(text) || [, slug])[1].trim();
  items.push({ id: `${slug}-passenger`, title, mode: 'With a passenger', note: 'Story only; the passenger holds the answer key.', text: PRIMER + text });
  const solo = join(root, 'dist', 'solo', `${slug}-solo.md`);
  if (existsSync(solo)) {
    items.push({ id: `${slug}-solo`, title, mode: 'Solo', note: 'Includes the answer key for the narrator. Don\'t read it.', text: PRIMER + readFileSync(solo, 'utf8') });
  }
}

const data = JSON.stringify(items).replace(/</g, '\\u003c');
const html = readFileSync(join(root, 'tools', 'story-loader', 'template.html'), 'utf8').replace('/*__DATA__*/null', data);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'story-loader.html'), html);
console.log(`wrote dist/story-loader.html with ${items.length} copy buttons`);
