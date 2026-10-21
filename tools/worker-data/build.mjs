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
import { kindOf, isFamily } from "../check-story/rules.mjs";
import { compileBranches } from "../check-story/branches.mjs";
import { compileTrivia } from "../check-story/trivia.mjs";
import { buildTeams } from "./build-teams.mjs";

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
// "preview" stories are built too, but the Worker never lists them: they start only when asked for
// by exact title or slug, so Ben can play one by voice on production before it is published.
const catalogJson = JSON.parse(readFileSync(join(root, "stories", "catalog.json"), "utf8"));
const previewSet = new Set(catalogJson.preview ?? []);
// "testing": published to everyone, marked as new and being tested (a badge, and a feedback ask).
const testingSet = new Set(catalogJson.testing ?? []);
// "seasonal": {slug: {from: "MM-DD", to: "MM-DD"}} (plan 2026-10-19, item 13): published, but listed and
// offered only between those dates each year (the Worker checks); outside them it starts by exact name.
const seasonal = catalogJson.seasonal ?? {};
// "weekly": {slug: {"2": "YYYY-MM-DD", ...}} (plan 2026-10-19, item 12): a serialized season. Chapter 1 is out
// when the story is published; each later chapter opens on its date (UTC), and the Worker says when.
const weekly = catalogJson.weekly ?? {};
for (const [slug, dates] of Object.entries(weekly)) for (const [ch, d] of Object.entries(dates)) {
  if (!/^\d+$/.test(ch) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`catalog.json weekly.${slug}: chapter numbers to YYYY-MM-DD dates`);
}
for (const [slug, w] of Object.entries(seasonal)) {
  if (!/^\d{2}-\d{2}$/.test(w?.from ?? "") || !/^\d{2}-\d{2}$/.test(w?.to ?? "")) throw new Error(`catalog.json seasonal.${slug}: from and to must be MM-DD`);
}
const published = catalogOnly ? new Set([...catalogJson.published, ...previewSet, ...Object.keys(seasonal)]) : null;
// A "testing" story must also be published (2026-10-21: Ballpark was only in "testing", so the
// production build left it out while dev, which builds every folder, showed it).
const unpublishedTesting = [...testingSet].filter((s) => !catalogJson.published.includes(s) && !seasonal[s]);
if (unpublishedTesting.length) throw new Error(`catalog.json: in "testing" but not "published": ${unpublishedTesting.join(", ")}`);

for (const slug of readdirSync(join(root, "stories")).sort()) {
  if (published && !published.has(slug)) continue;
  const dir = join(root, "stories", slug);
  // Every kind but a rules-only game needs its secrets.md; a story folder without one is a draft.
  if (!existsSync(join(dir, "story.md"))) continue;
  // Team trivia (trivia_source: teams) takes its boards from teams/, so it needs no secrets.md either.
  if (!existsSync(join(dir, "secrets.md")) && !/^\s*(kind:\s*(game|campaign)\b|trivia_source:\s*teams\b)/m.test(readFileSync(join(dir, "story.md"), "utf8"))) continue;
  const story = readFileSync(join(dir, "story.md"), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  // A game the narrator runs from its rules alone (kind: game) may have no secrets.md.
  const secretsPath = join(dir, "secrets.md");
  const secrets = (existsSync(secretsPath) ? readFileSync(secretsPath, "utf8") : "").replace(
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
  // The table may be the last section of secrets.md: "the next heading or the end" closes it.
  const listenFor = (/^#{2,3}\s+Listen for[^\n]*\n([\s\S]*?)(?=^#{2,3}\s|(?![\s\S]))/im.exec(secrets) || [, null])[1];
  const connector = connectorStory(story);
  dropped.push(...connector.dropped);
  for (const d of dropped) warnings.push(`${slug}: dropped a wrangler sentence: ${d}`);
  stories.push({
    slug,
    preview: previewSet.has(slug),
    testing: testingSet.has(slug),
    ...(seasonal[slug] ? { season: { from: seasonal[slug].from, to: seasonal[slug].to } } : {}),
    ...(weekly[slug] ? { release: weekly[slug] } : {}),
    title: field(fm, "title") || slug,
    genre: field(fm, "genre"),
    tone: field(fm, "tone").toLowerCase(),
    kind: kindOf({ kind: field(fm, "kind"), genre: field(fm, "genre") }),
    audience: isFamily({ audience: field(fm, "audience"), genre: field(fm, "genre") }) ? "family" : "general",
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
    // Choose-your-path stories: the node graph, served one node at a time by the choose tool.
    branches: kindOf({ kind: field(fm, "kind"), genre: field(fm, "genre") }) === "branching" ? compileBranches(secrets) : null,
    // Trivia boards: categories, values, clues and answers, served one clue at a time.
    trivia: kindOf({ kind: field(fm, "kind"), genre: field(fm, "genre") }) === "trivia" && field(fm, "trivia_source") !== "teams" ? compileTrivia(secrets) : null,
    // Games with a hidden pick (twenty questions, mode b): the server picks one per play.
    picks: [...((/^##\s+Picks\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(secrets) || [, ""])[1].matchAll(/^\s*[-*]\s+(.+)$/gm))].map((m) => m[1].trim()),
  });
}

const outDir = join(root, "worker", "src", "generated");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "stories.json"), JSON.stringify(stories, null, 2));
// What's new (stories/whats-new.json): newest first, each {id: "YYYY-MM-DD-slug", line}. Read aloud by
// open_plot_speaks and shown on the home page. Checked here so a bad entry fails the build, not a play.
const news = JSON.parse(readFileSync(join(root, "stories", "whats-new.json"), "utf8"));
if (!Array.isArray(news) || news.some((n) => !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(n.id) || typeof n.line !== "string" || n.line.length < 10 || n.line.length > 220)) throw new Error("stories/whats-new.json: entries need an id like 2026-10-19-name and a line of 10-220 characters");
if (news.some((n, i) => i && n.id > news[i - 1].id)) throw new Error("stories/whats-new.json: newest first");
writeFileSync(join(outDir, "news.json"), JSON.stringify(news, null, 2));
// The sports team database (tools/teams/README.md), for the team-trivia story.
const teams = buildTeams(root);
console.log(`wrote worker/src/generated/teams.json: ${teams.length} teams`);
console.log(
  `wrote worker/src/generated/stories.json: ${stories.map((s) => `${s.slug} (${s.endings.length} endings, ${Object.keys(s.cues).length} cues${s.story_connector.length > 1 ? `, ${s.story_connector.length} chapters` : ""}${s.full_reveal ? ", full reveal" : ""}${s.branches ? `, ${Object.keys(s.branches.nodes).length} nodes` : ""})`).join(", ")}`,
);
// The connector text must never mention the wrangler: a sentence dropped by the fallback means a
// phrasing connector.mjs doesn't rewrite yet. GM sentences only, never answer text.
for (const w of warnings) console.log(`WARN  ${w}`);
