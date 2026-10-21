// Sports team trivia (Ben, 2026-10-19): the player names a team; the host runs a trivia board about
// it from the team database (teams/<league>/<slug>.md, built into generated/teams.json), reads the
// team's nickname and tagline, and can read the current roster from ESPN's public site API.
import teamsJson from "./generated/teams.json";
import type { TriviaBoard } from "./games";

export type Team = {
  slug: string; league: string; league_name: string; name: string; short: string; location: string; abbreviation: string;
  aliases: string[]; nickname: string; tagline: string; sport: string; espn_id: string; trivia: TriviaBoard;
};
export const TEAMS = teamsJson as unknown as Team[];
/** The story slug that plays team trivia; its board comes from the team, not from secrets.md. */
export const TEAM_TRIVIA = "team-trivia";

export const LEAGUES_COVERED = [...new Set(TEAMS.map((t) => t.league_name))];
const bySlug = new Map(TEAMS.map((t) => [t.slug, t]));
export const teamBySlug = (slug: string) => bySlug.get(slug) ?? null;
export const teamBoard = (slug: string): TriviaBoard | null => bySlug.get(slug)?.trivia ?? null;

// "The New York Yankees!" -> "new york yankees"; accents and punctuation dropped, a leading "the" too.
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
const FILLER = new Set(["the", "fc", "sc", "cf", "club", "team", "of", "de", "and", "a", "an", "trivia", "quiz", "about", "on", "for"]);
const toks = (s: string) => norm(s).split(" ").filter((w) => w && !FILLER.has(w));

const namesOf = (t: Team) => [t.name, t.short, t.location, t.abbreviation, ...t.aliases, ...t.nickname.split(";")].map(norm).filter(Boolean);
// What a name matches on, best first: the team's own name, then an alias, nickname or abbreviation,
// then only its city (so "Liverpool" is Liverpool, not Everton, whose city it is).
const tiersOf = (t: Team) => [
  [t.name, t.short].map(norm),
  [t.abbreviation, ...t.aliases, ...t.nickname.split(";")].map(norm),
  [t.location].map(norm),
].map((tier) => tier.filter(Boolean));

/**
 * Finds the team a player named: an exact name, short name, city, abbreviation, alias or nickname
 * first; then every word of what they said inside a team's names. One match is the team; several
 * are candidates to ask about ("Rangers": Texas or New York?); none means it isn't in the database.
 */
export function resolveTeam(query: string): { team: Team } | { candidates: Team[] } | { none: true } {
  const q = norm(query);
  if (!q) return { none: true };
  for (let tier = 0; tier < 3; tier++) {
    const hit = TEAMS.filter((t) => tiersOf(t)[tier].includes(q));
    if (hit.length === 1) return { team: hit[0] };
    if (hit.length > 1) return { candidates: hit };
  }
  const words = toks(query);
  if (!words.length) return { none: true };
  const loose = TEAMS.filter((t) => { const bag = new Set(namesOf(t).flatMap((n) => n.split(" "))); return words.every((w) => bag.has(w)); });
  if (loose.length === 1) return { team: loose[0] };
  if (loose.length > 1 && loose.length <= 6) return { candidates: loose };
  return { none: true };
}

export const teamLine = (t: Team) => `${t.name} (${t.league_name})`;

/** What the host says when the team is found: the nickname and tagline to use in the patter. */
export function teamIntro(t: Team): string {
  return [
    `THE TEAM: ${t.name}, ${t.league_name}.`,
    t.nickname ? `Nickname (use it in your patter): ${t.nickname}.` : "",
    t.tagline ? `Tagline (say it when you open the board, like a fan would): "${t.tagline}".` : "",
    `The board has two categories: "Then" (the team's history) and "Now" (the team today), five clues each, and a final. ` +
    `If they ask who's on the team, call team_roster with the team's name; it reads the current roster from ESPN.`,
  ].filter(Boolean).join("\n");
}

type Athlete = { fullName?: string; displayName?: string; jersey?: string; position?: { abbreviation?: string; name?: string; displayName?: string } };
type RosterJson = { athletes?: (Athlete | { position?: string; items?: Athlete[] })[]; coach?: { firstName?: string; lastName?: string }[]; team?: { displayName?: string } };

/** Today's players from ESPN (name, number, position), or null if ESPN doesn't answer. Cached six hours. */
async function rosterPlayers(t: Team): Promise<{ name: string; jersey: string; position: string }[] | null> {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${t.sport}/teams/${t.espn_id}/roster`, { cf: { cacheTtl: 6 * 3600, cacheEverything: true } } as RequestInit);
    if (!res.ok) return null;
    const data = (await res.json()) as RosterJson;
    const flat = (data.athletes ?? []).flatMap((e) => ("items" in e && Array.isArray(e.items) ? e.items : [e as Athlete]));
    return flat.map((a) => ({ name: a.fullName ?? a.displayName ?? "", jersey: a.jersey ?? "", position: a.position?.displayName ?? a.position?.name ?? "" }))
      .filter((p) => p.name.split(" ").length >= 2 && p.jersey && p.position);
  } catch { return null; }
}

/**
 * "Name the player" (plan 2026-10-19, item 16): a Roster category from today's ESPN roster, five players at
 * 100 to 500, each clue in three steps (position, number, first initial), so it is fresh every week.
 * null when ESPN has too few players with a number and a position.
 */
export async function rosterCategory(t: Team, rand: () => number = Math.random): Promise<TriviaBoard["categories"][number] | null> {
  const players = await rosterPlayers(t);
  if (!players || players.length < 8) return null;
  const pool = [...players];
  const picked = [100, 200, 300, 400, 500].map((value) => ({ value, p: pool.splice(Math.floor(rand() * pool.length), 1)[0] }));
  return {
    name: "Roster",
    final: false,
    clues: picked.map(({ value, p }) => {
      const parts = p.name.split(" ");
      return {
        value,
        steps: [`This player is a ${p.position.toLowerCase()} on the ${t.short} roster today. Who is it?`, `They wear number ${p.jersey}.`, `Their first name starts with ${parts[0][0]}.`],
        answer: p.name,
        also: [parts.slice(1).join(" ")],
        asOf: "today's ESPN roster",
      };
    }),
  };
}

/** Two teams' boards side by side for a rivalry game: each team's Then and Now, and the first team's final. */
export function rivalryBoard(a: Team, b: Team): TriviaBoard {
  const named = (t: Team) => t.trivia.categories.filter((c) => !c.final).map((c) => ({ ...c, name: `${t.short} ${c.name}` }));
  const fin = a.trivia.categories.find((c) => c.final);
  return { categories: [...named(a), ...named(b), ...(fin ? [{ ...fin, name: `${a.short} and ${b.short}` }] : [])] };
}

/** The current roster from ESPN, grouped by position, in lines the host can read; cached for six hours. */
export async function rosterText(t: Team): Promise<string> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${t.sport}/teams/${t.espn_id}/roster`;
  let data: RosterJson;
  try {
    const res = await fetch(url, { cf: { cacheTtl: 6 * 3600, cacheEverything: true } } as RequestInit);
    if (!res.ok) return `ESPN didn't answer for the ${t.short} roster just now (status ${res.status}). Say so, and offer to try again in a minute or carry on with the trivia.`;
    data = (await res.json()) as RosterJson;
  } catch {
    return `The roster couldn't be fetched from ESPN just now. Say so, and offer to try again in a minute or carry on with the trivia.`;
  }
  const groups: { position: string; players: string[] }[] = [];
  const line = (a: Athlete) => `${a.fullName ?? a.displayName ?? "?"}${a.jersey ? ` (${a.jersey})` : ""}${a.position?.abbreviation ? `, ${a.position.abbreviation}` : ""}`;
  for (const entry of data.athletes ?? []) {
    if ("items" in entry && Array.isArray(entry.items)) groups.push({ position: String(entry.position ?? "Players"), players: entry.items.map(line) });
    else {
      const a = entry as Athlete;
      const pos = a.position?.displayName ?? a.position?.name ?? a.position?.abbreviation ?? "Players";
      let g = groups.find((x) => x.position === pos);
      if (!g) { g = { position: pos, players: [] }; groups.push(g); }
      g.players.push(line(a));
    }
  }
  const total = groups.reduce((n, g) => n + g.players.length, 0);
  if (!total) return `ESPN lists no roster for the ${t.short} right now. Say so and carry on with the trivia.`;
  const coach = data.coach?.[0] ? `${data.coach[0].firstName ?? ""} ${data.coach[0].lastName ?? ""}`.trim() : "";
  return [
    `ROSTER: ${t.name}, ${total} players, from ESPN today (it changes; say "as of today"). Numbers in brackets. Read it a group at a time: name the groups first and ask which they want, or read the one they asked for. Never read all ${total} names in one turn.`,
    coach ? `Head coach: ${coach}.` : "",
    ...groups.map((g) => `${g.position} (${g.players.length}): ${g.players.join("; ")}`),
  ].filter(Boolean).join("\n");
}
