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
  // Through the connector there is no passenger, so the narrator also gets each cue's
  // "Wrangler only" notes (what to listen for, follow-up cues), marked never to be read aloud.
  // Solo-mode playtests showed narrators keep such notes private (docs/DECISIONS.md).
  const wranglerOnly = (id) => {
    const sec = new RegExp(`^##\\s+S${id}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im").exec(secrets);
    if (!sec) return null;
    const m = /\*\*Wrangler only[^*]*:\*\*\s*([\s\S]*?)(?=^\*\*[A-Z][^\n]*:\*\*|(?![\s\S]))/im.exec(sec[1]);
    return m ? m[1].trim() : null;
  };
  const cues = {};
  for (const id of cueIds) {
    const c = extractCue(secrets, id);
    if (c) cues[`S${id}`.toUpperCase()] = { read_aloud: c, narrator_only: wranglerOnly(id) };
  }
  const listenFor = (/^#{2,3}\s+Listen for[^\n]*\n([\s\S]*?)(?=^#{2,3}\s)/im.exec(secrets) || [, null])[1];
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
    listen_for: listenFor ? listenFor.trim() : null,
  });
}

const outDir = join(root, "worker", "src", "generated");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "stories.json"), JSON.stringify(stories, null, 2));
console.log(
  `wrote worker/src/generated/stories.json: ${stories.map((s) => `${s.slug} (${s.endings.length} endings, ${Object.keys(s.cues).length} cues)`).join(", ")}`,
);
