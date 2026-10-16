// Builds worker/src/generated/stories.json from stories/<slug>/story.md + secrets.md.
// The JSON holds only what the Worker serves: the public story text (for the site), its
// connector version (story_connector, for start_story: no paste-play wrangler text, no front
// matter, one part per chapter; see connector.mjs), the per-suspect Endings detail lines
// (check_accusation), the cue sections (get_cue: read-aloud, plus narrator notes rewritten for
// the connector), the raw Listen-for table (passenger page) and the `## Full reveal` section
// (reveal_solution). The rest of secrets.md never leaves this machine.
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
import { parseEndings, extractCue, parseFullReveal } from "../playtest/lib.mjs";
import { connectorStory, connectorNotes } from "./connector.mjs";

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
const warnings = [];
// --catalog: build only the stories published in stories/catalog.json (production). Without it,
// every story folder is built (dev), so drafts can be tested before they are published.
const catalogOnly = process.argv.includes("--catalog");
const published = catalogOnly
  ? new Set(JSON.parse(readFileSync(join(root, "stories", "catalog.json"), "utf8")).published)
  : null;

for (const slug of readdirSync(join(root, "stories")).sort()) {
  if (published && !published.has(slug)) continue;
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
  const dropped = [];
  const clean = (t) => {
    if (!t) return t;
    const r = connectorNotes(t);
    dropped.push(...r.dropped);
    return r.text;
  };
  const cues = {};
  for (const id of cueIds) {
    const c = extractCue(secrets, id);
    if (c) cues[`S${id}`.toUpperCase()] = { read_aloud: clean(c), narrator_only: clean(wranglerOnly(id)) };
  }
  const listenFor = (/^#{2,3}\s+Listen for[^\n]*\n([\s\S]*?)(?=^#{2,3}\s)/im.exec(secrets) || [, null])[1];
  const connector = connectorStory(story);
  dropped.push(...connector.dropped);
  for (const d of dropped) warnings.push(`${slug}: dropped a wrangler sentence: ${d}`);
  stories.push({
    slug,
    title: field(fm, "title") || slug,
    genre: field(fm, "genre"),
    players: field(fm, "players"),
    duration_minutes: Number(field(fm, "duration_minutes")) || null,
    story,
    story_connector: connector.parts,
    endings: parseEndings(secrets).map(({ name, verdict, text }) => ({
      name,
      verdict,
      text,
    })),
    cues,
    // For get_cue's S1 notes (rewritten for the connector) and the passenger page (raw: it reads cue ids only).
    listen_for: listenFor ? clean(listenFor.trim()) : null,
    listen_for_raw: listenFor ? listenFor.trim() : null,
    full_reveal: parseFullReveal(secrets),
  });
}

const outDir = join(root, "worker", "src", "generated");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "stories.json"), JSON.stringify(stories, null, 2));
console.log(
  `wrote worker/src/generated/stories.json: ${stories.map((s) => `${s.slug} (${s.endings.length} endings, ${Object.keys(s.cues).length} cues${s.story_connector.length > 1 ? `, ${s.story_connector.length} chapters` : ""}${s.full_reveal ? ", full reveal" : ""})`).join(", ")}`,
);
// The connector text must never mention the wrangler: a sentence dropped by the fallback means a
// phrasing connector.mjs doesn't rewrite yet. GM sentences only, never answer text.
for (const w of warnings) console.log(`WARN  ${w}`);
