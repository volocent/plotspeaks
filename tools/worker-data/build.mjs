// Builds worker/src/generated/stories.json from stories/<slug>/story.md + secrets.md.
// The JSON holds only what the Worker serves: the public story text, the per-suspect
// Endings detail lines (reveal) and the read-aloud parts of cue sections (get_cue). The
// "Wrangler only" parts and the rest of secrets.md never leave this machine.
// The output is gitignored because it contains solutions.
// Usage: node tools/worker-data/build.mjs
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEndings, extractCue } from "../playtest/lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const field = (fm, key) => {
  const m = new RegExp(`^\\s*${key}:\\s*(.+)$`, "m").exec(fm);
  return m
    ? m[1]
        .replace(/\s+#.*$/, "")
        .replace(/^["']|["']$/g, "")
        .trim()
    : "";
};

const stories = [];
for (const slug of readdirSync(join(root, "stories")).sort()) {
  const dir = join(root, "stories", slug);
  if (
    !existsSync(join(dir, "story.md")) ||
    !existsSync(join(dir, "secrets.md"))
  )
    continue;
  const story = readFileSync(join(dir, "story.md"), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const secrets = readFileSync(join(dir, "secrets.md"), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const fm = (/^---\n([\s\S]*?)\n---/.exec(story) || [, ""])[1];
  const cueIds = [...secrets.matchAll(/^##\s+S(\d+[a-z]?)\b/gim)].map(
    (m) => m[1],
  );
  const cues = {};
  for (const id of cueIds) {
    const c = extractCue(secrets, id);
    if (c) cues[`S${id}`.toUpperCase()] = c;
  }
  stories.push({
    slug,
    title: field(fm, "title") || slug,
    genre: field(fm, "genre"),
    players: field(fm, "players"),
    duration_minutes: Number(field(fm, "duration_minutes")) || null,
    story,
    endings: parseEndings(secrets).map(({ name, verdict, text }) => ({
      name,
      verdict,
      text,
    })),
    cues,
  });
}

const outDir = join(root, "worker", "src", "generated");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "stories.json"), JSON.stringify(stories, null, 2));
console.log(
  `wrote worker/src/generated/stories.json: ${stories.map((s) => `${s.slug} (${s.endings.length} endings, ${Object.keys(s.cues).length} cues)`).join(", ")}`,
);
