// Builds worker/src/generated/teams.json from teams/<league>/<slug>.md (Ben, 2026-10-19: sports team
// trivia). Only teams with clues are included, so the game grows as the files are filled. Each entry:
// the names a fan might say, the nickname and tagline the host reads, the ESPN sport path and id the
// roster tool needs, and the compiled trivia board (two categories, Then and Now, and a Final).
// Called from build.mjs; also: node tools/worker-data/build-teams.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTrivia } from "../check-story/trivia.mjs";

const LEAGUE_NAMES = { mlb: "MLB", nba: "NBA", nhl: "NHL", cfb: "college football", epl: "the Premier League", mls: "MLS", laliga: "La Liga", bundesliga: "the Bundesliga", seriea: "Serie A", ligue1: "Ligue 1" };

function front(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fm = {};
  if (!m) return null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return fm;
}
const list = (s) => String(s ?? "").split(";").map((x) => x.trim()).filter(Boolean);

export function buildTeams(root) {
  const dir = join(root, "teams");
  const out = [];
  // No teams/ (the public repository leaves the team database out): an empty teams.json, so the Worker still builds.
  if (!existsSync(dir)) { const outDir = join(root, "worker", "src", "generated"); mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, "teams.json"), "[]"); return out; }
  for (const league of readdirSync(dir).filter((d) => !d.includes("."))) {
    for (const file of readdirSync(join(dir, league)).filter((f) => f.endsWith(".md"))) {
      const text = readFileSync(join(dir, league, file), "utf8");
      const fm = front(text);
      const trivia = compileTrivia(text);
      if (!fm || !trivia || !trivia.categories.some((c) => c.clues.length)) continue;
      out.push({
        slug: file.replace(/\.md$/, ""), league, league_name: LEAGUE_NAMES[league] ?? league,
        name: fm.name, short: fm.short, location: fm.location, abbreviation: fm.abbreviation,
        aliases: list(fm.aliases), nickname: fm.nickname, tagline: fm.tagline,
        sport: fm.sport, espn_id: fm.espn_id, trivia,
      });
    }
  }
  const outDir = join(root, "worker", "src", "generated");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "teams.json"), JSON.stringify(out));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const teams = buildTeams(root);
  console.log(`wrote worker/src/generated/teams.json: ${teams.length} teams`);
}
