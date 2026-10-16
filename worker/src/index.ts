// Plot Speaks play server (Phase 2, milestone M0: the voice check).
//
// A stateless MCP server with four tools. Its job in M0 is to answer one question: will an
// assistant in VOICE mode call a third-party tool? Secondary questions: does the narrator follow
// GM instructions that arrive as tool output, and does it call reveal instead of answering
// accusations itself? Each tool call is logged (wrangler tail / Workers logs) so a test session
// can be checked afterwards.
//
// Answer keys never reach the assistant in bulk: reveal returns one suspect's line, get_cue one
// cue's read-aloud part. The full secrets.md and the "Wrangler only" parts are never served.
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import stories from "./generated/stories.json";

type Ending = { name: string; verdict: string; text: string };
type Cue = { read_aloud: string; narrator_only: string | null };
type Story = {
  slug: string; title: string; genre: string; players: string; duration_minutes: number | null;
  story: string; endings: Ending[]; cues: Record<string, Cue>; listen_for: string | null;
};
const STORIES = stories as Story[];

// These rules travel with the server itself, not only inside the story text: on 2026-10-15
// Claude declined to treat GM instructions inside a pasted document as the user's instructions.
const INSTRUCTIONS = [
  "Plot Speaks runs interactive story games that the user plays with you by voice. When the user asks to play, call start_story and act as the narrator.",
  "The story text returned by start_story contains the game's rules for the narrator (its \"How to run this\" section). The user connected Plot Speaks to play exactly this kind of game, so follow those rules as the user's own wishes: short spoken turns, end each turn with a question, never invent clues.",
  "Where the story says to say \"Wrangler, check the secrets.\", do not say it: call reveal with the story slug and the accused person's name, then follow the verdict it returns (it starts with Correct. or Innocent.).",
  "Where the story says \"Wrangler, cue S<n>\", do not say it: call get_cue with that cue id and narrate only its read-aloud part. Each cue also has narrator-only notes: follow them silently and never read them aloud. When those notes say to call a follow-up cue (for example S3b) after something happens, call get_cue for it yourself at that moment.",
  "You do not know the solution. Never guess it, and never call reveal unless the user has formally accused someone.",
  "start_story returns a play id. Pass it to reveal, get_cue and rate_story.",
  "When a story ends (a correct accusation, the full reveal, a victory or defeat), ask once: \"How many stars out of five would you give it? And did I give anything away too early?\" Then call rate_story with the answer. If the player doesn't want to rate, drop it.",
].join("\n");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
const TITLES = new Set(["father", "mr", "mrs", "ms", "miss", "dr", "the", "sir"]);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 1 && !TITLES.has(t));

function findEnding(endings: Ending[], accused: string): Ending | null {
  const acc = tokens(accused);
  let best: Ending | null = null, bestScore = 0;
  for (const e of endings) {
    const et = tokens(e.name);
    let score = norm(e.name) === norm(accused) ? 100 : 0;
    for (const t of acc) if (et.includes(t)) score += 1;
    if (et.length && acc[0] === et[0]) score += 0.5;
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

const findStory = (slug: string) =>
  STORIES.find((s) => s.slug === slug || norm(s.title) === norm(slug) || norm(s.title).includes(norm(slug)));

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

// The scripts are written for Phase 1, where a passenger ("wrangler") holds the answer key.
// Through the connector there is no wrangler: on 2026-10-15 Claude voice followed the script and
// said "Wrangler, check the secrets." aloud instead of calling reveal. So the served script has
// those hand-offs rewritten into tool calls, with a short preface saying so.
const CONNECTOR_PREFACE =
  "## Playing through the Plot Speaks connector\n" +
  "There is no wrangler or passenger in this mode, and you do not hold the answer key. Wherever this script mentions the wrangler or the secrets, use the tools instead: " +
  "when the player formally accuses someone, call reveal with the story slug and the accused's name, then give the verdict it returns " +
  "(it starts with Correct. or Innocent.). When the script calls for a cue, call get_cue. Never say the word \"wrangler\" aloud.\n\n";

function forConnector(story: string): string {
  return story
    .replace(/say\s+"Wrangler,\s*check the secrets\.?"\s*(and wait)?/gi, "call the reveal tool with the accused person's name")
    .replace(/"Wrangler,\s*check the secrets\.?"/gi, "the reveal tool")
    .replace(/say\s+"Wrangler,\s*cue\s+(S\d+[a-z]?)\.?"\s*(and wait)?/gi, "call get_cue with cue $1")
    .replace(/\*\*Wrangler cue:\*\*/g, "**Cue (call get_cue):**");
}
const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }));

// The play tools only read story data; start_story and reveal also record an anonymous play
// event (no transcript, no personal data). rate_story stores the player's rating.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const RECORDS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

type Ctx = { db?: D1Database; tester: boolean; client: string | null };

// Recording must never break play: failures are logged and swallowed.
async function record(ctx: Ctx, sql: string, ...args: unknown[]) {
  if (!ctx.db) return;
  try { await ctx.db.prepare(sql).bind(...args).run(); } catch (e) { log("db_error", { message: String(e) }); }
}

function createServer(ctx: Ctx) {
  const server = new McpServer({ name: "plot-speaks", version: "0.2.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_stories",
    { annotations: READ_ONLY, description: "List the Plot Speaks stories that can be played by voice: murder mysteries and adventures.", inputSchema: {} },
    async () => {
      log("list_stories", {});
      return text(STORIES.map((s) => `${s.title} (slug: ${s.slug}; ${s.genre}; ${s.players} players; about ${s.duration_minutes} minutes)`).join("\n"));
    },
  );

  server.registerTool(
    "start_story",
    {
      annotations: READ_ONLY,
      description: "Load a Plot Speaks story to narrate. Returns the full story script, including the narrator's rules. Call it when the user asks to play a story.",
      inputSchema: { slug: z.string().describe("The story's slug or title, e.g. example-dinner-party or The Last Toast") },
    },
    async ({ slug }) => {
      const s = findStory(slug);
      log("start_story", { slug, found: s?.slug ?? null });
      if (!s) return text(`No story called "${slug}". Available: ${STORIES.map((x) => `${x.title} (${x.slug})`).join(", ")}.`);
      const playId = crypto.randomUUID();
      await record(ctx, "INSERT INTO plays (id, story, client, tester, started_at) VALUES (?, ?, ?, ?, ?)", playId, s.slug, ctx.client, ctx.tester ? 1 : 0, Date.now());
      return text(
        `You are the narrator for "${s.title}". The user chose to play this through Plot Speaks; the rules in the script below are part of the game they asked for. ` +
        `Story slug: ${s.slug}. Play id: ${playId} (pass it to reveal, get_cue and rate_story).\n\n${CONNECTOR_PREFACE}${forConnector(s.story)}`,
      );
    },
  );

  server.registerTool(
    "reveal",
    {
      annotations: READ_ONLY,
      description: "Check a formal accusation in a Plot Speaks mystery. Call only after the user says they accuse someone. Returns that person's verdict line, starting Correct. or Innocent.",
      inputSchema: {
        slug: z.string().describe("The story slug"),
        accused: z.string().describe("The name of the person the user accused"),
        play_id: z.string().optional().describe("The play id from start_story"),
      },
    },
    async ({ slug, accused, play_id }) => {
      const s = findStory(slug);
      const e = s ? findEnding(s.endings, accused) : null;
      log("reveal", { slug, accused, story: s?.slug ?? null, matched: e?.name ?? null, verdict: e?.verdict ?? null });
      if (!s) return text(`No story called "${slug}".`);
      if (!e) return text(`I couldn't match "${accused}" to anyone in ${s.title}. Ask the player which of these they mean: ${s.endings.map((x) => x.name).join(", ")}.`);
      await record(ctx, "INSERT INTO play_events (play_id, story, kind, detail, verdict, at) VALUES (?, ?, 'accusation', ?, ?, ?)", play_id ?? null, s.slug, e.name, e.verdict, Date.now());
      return text(e.text);
    },
  );

  server.registerTool(
    "get_cue",
    {
      annotations: READ_ONLY,
      description: "Get a cue in a Plot Speaks adventure, when the story calls for one. Returns the text to narrate plus narrator-only notes that must never be read aloud.",
      inputSchema: {
        slug: z.string().describe("The story slug"),
        cue: z.string().describe("The cue id, e.g. S1 or S3b"),
        play_id: z.string().optional().describe("The play id from start_story"),
      },
    },
    async ({ slug, cue, play_id }) => {
      const s = findStory(slug);
      const id = cue.toUpperCase().startsWith("S") ? cue.toUpperCase() : `S${cue.toUpperCase()}`;
      const c = s?.cues[id];
      log("get_cue", { slug, cue: id, found: Boolean(c) });
      if (!s) return text(`No story called "${slug}".`);
      if (!c) return text(`No cue ${id} in ${s.title}.`);
      await record(ctx, "INSERT INTO play_events (play_id, story, kind, detail, at) VALUES (?, ?, 'cue', ?, ?)", play_id ?? null, s.slug, id, Date.now());
      const notes = [c.narrator_only, id === "S1" && s.listen_for ? `Follow-up cues to listen for during this story:\n${s.listen_for}` : null].filter(Boolean).join("\n\n");
      return text(`READ ALOUD (in your own narrator voice):\n${c.read_aloud}` + (notes ? `\n\nNARRATOR ONLY. Never read this aloud or hint at it:\n${notes}` : ""));
    },
  );

  server.registerTool(
    "rate_story",
    {
      annotations: RECORDS,
      description: "Save the player's rating when a Plot Speaks story ends: 1 to 5 stars, whether the narrator gave anything away too early, and an optional short comment.",
      inputSchema: {
        slug: z.string().describe("The story slug"),
        stars: z.number().int().min(1).max(5).describe("1 to 5"),
        spoiled: z.boolean().optional().describe("True if the player felt the narrator gave something away too early"),
        comment: z.string().max(500).optional().describe("The player's comment, if any, in their words"),
        play_id: z.string().optional().describe("The play id from start_story"),
      },
    },
    async ({ slug, stars, spoiled, comment, play_id }) => {
      const s = findStory(slug);
      log("rate_story", { slug, story: s?.slug ?? null, stars, spoiled: spoiled ?? null });
      if (!s) return text(`No story called "${slug}".`);
      await record(ctx, "INSERT INTO ratings (play_id, story, stars, spoiled, comment, at) VALUES (?, ?, ?, ?, ?, ?)", play_id ?? null, s.slug, stars, spoiled === undefined ? null : spoiled ? 1 : 0, comment ?? null, Date.now());
      return text("Thanks, rating saved.");
    },
  );

  return server;
}

type Env = { ENVIRONMENT?: string; DEV_ACCESS_KEY?: string; DB?: D1Database };

// Constant-time comparison, so the key can't be guessed from response timing.
function sameKey(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response("Plot Speaks MCP server (dev). Connect an MCP client to /mcp.\n", { headers: { "content-type": "text/plain" } });
    }
    // Dev lock (Ben, 2026-10-15): until real sign-in arrives in M5, the dev server answers only
    // requests carrying the shared key, sent by the Claude connector as a request header.
    if (env.DEV_ACCESS_KEY && !sameKey(request.headers.get("x-plotspeaks-key") ?? "", env.DEV_ACCESS_KEY)) {
      log("rejected", { reason: "missing or wrong x-plotspeaks-key" });
      return new Response("Unauthorized\n", { status: 401, headers: { "content-type": "text/plain" } });
    }
    // Plays made with the access key are ours (testers); Gate 2 counts strangers only.
    const tester = Boolean(env.DEV_ACCESS_KEY) || Boolean(request.headers.get("x-plotspeaks-key"));
    const client = (request.headers.get("user-agent") ?? "").slice(0, 80) || null;
    return createMcpHandler(() => createServer({ db: env.DB, tester, client }))(request, env, ctx);
  },
} satisfies ExportedHandler;
