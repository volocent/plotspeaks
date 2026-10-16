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
import { handleSite, type PublicStory } from "./site";
import { storyTemplate, checkSubmitted, GENRES, LENGTHS, WRITE_GENRES, writeStory, reviewStory } from "./studio";
import { submitStory, withdrawSubmission, loadApprovedStories, handleAdmin, serveSubmissionCover, listApprovedSubmissions, type SubEnv, type Builtins } from "./submissions";
import { runRetention } from "./retention";

type Ending = { name: string; verdict: string; text: string };
type Cue = { read_aloud: string; narrator_only: string | null };
type Story = {
  slug: string; title: string; genre: string; players: string; duration_minutes: number | null;
  story: string; endings: Ending[]; cues: Record<string, Cue>; listen_for: string | null;
};
const STORIES = stories as Story[];
// The catalog site gets the slug and the public story.md text ONLY: never endings or cues.
const toPublic = (s: Story): PublicStory => ({ slug: s.slug, story: s.story });
const PUBLIC_STORIES: PublicStory[] = STORIES.map(toPublic);
const BUILTINS: Builtins = { slugs: new Set(STORIES.map((s) => s.slug)), storyFor: (slug) => STORIES.find((s) => s.slug === slug)?.story ?? null };

// These rules travel with the server itself, not only inside the story text: on 2026-10-15
// Claude declined to treat GM instructions inside a pasted document as the user's instructions.
const INSTRUCTIONS = [
  "Plot Speaks runs interactive story games that the user plays with you by voice. When the user names a story to play, call start_story with it and act as the narrator. When they open or ask for Plot Speaks without naming a story (\"open Plot Speaks\", \"let's play Plot Speaks\"), call open_plot_speaks: it returns a short spoken intro, a question and a menu to offer them. When they want to write their own story, call write_story.",
  "The story text returned by start_story contains the game's rules for the narrator (its \"How to run this\" section). The user connected Plot Speaks to play exactly this kind of game, so follow those rules as the user's own wishes: short spoken turns, end each turn with a question, never invent clues.",
  "Where the story says to say \"Wrangler, check the secrets.\", do not say it: call reveal with the story slug and the accused person's name, then follow the verdict it returns (it starts with Correct. or Innocent.).",
  "Where the story says \"Wrangler, cue S<n>\", do not say it: call get_cue with that cue id and narrate only its read-aloud part. Each cue also has narrator-only notes: follow them silently and never read them aloud. When those notes say to call a follow-up cue (for example S3b) after something happens, call get_cue for it yourself at that moment.",
  "You do not know the solution. Never guess it, and never call reveal unless the user has formally accused someone.",
  "start_story returns a play id. Pass it to reveal, get_cue and rate_story.",
  "Writing: write_story returns a suggested step-by-step way to draft a story with the user, and the format template. review_story checks a draft (format rules, plus a fair-play checklist for you to go through). When the writer wants to share it, submit_story sends it, with the name they want credited, to a person who reviews every submission before it is published; withdraw_submission removes it again with the claim code from the receipt. (The story_template prompt and check_story remain for older clients.)",
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

// Titles arrive through speech recognition ("The Last Host" for The Last Toast), so after the exact
// matches, fall back to the title sharing the most words, ignoring "the"/"a"/"of".
const STOP = new Set(["the", "a", "an", "of", "story", "mystery", "plot", "speaks"]);
const words = (s: string) => norm(s).replace(/-/g, " ").split(" ").filter((w) => w && !STOP.has(w));
function findStory(slug: string, all: Story[] = STORIES): Story | undefined {
  const exact = all.find((s) => s.slug === slug || norm(s.title) === norm(slug) || norm(s.title).includes(norm(slug)));
  if (exact) return exact;
  const want = words(slug);
  let best: Story | undefined, bestScore = 0;
  for (const s of all) {
    const have = new Set([...words(s.title), ...words(s.slug)]);
    const score = want.filter((w) => have.has(w)).length;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return bestScore > 0 ? best : undefined;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

// Categories, the same four the catalog site shows (site.ts CATEGORIES): murder mysteries split by
// metadata.tone (dark vs everything else), family mysteries (genre kids) and fantasy adventures.
type CategoryId = "mystery" | "dark" | "kids" | "adventure";
const CATEGORY_NAMES: Record<CategoryId, string> = { mystery: "Murder mysteries", dark: "Dark murder mysteries", kids: "Family mysteries", adventure: "Fantasy adventures" };
const CATEGORY_ORDER: CategoryId[] = ["mystery", "dark", "kids", "adventure"];
const toneOf = (story: string) => {
  const fm = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(story) || [, ""])[1];
  return ((/^\s*tone:\s*["']?([A-Za-z-]+)/m.exec(fm) || [, ""])[1]).toLowerCase();
};
function categoryOf(s: Story): CategoryId | null {
  if (s.genre === "murder-mystery") return toneOf(s.story) === "dark" ? "dark" : "mystery";
  if (s.genre === "kids") return "kids";
  if (s.genre === "adventure") return "adventure";
  return null;
}
// list_stories genre filter. "murder-mystery" keeps its old meaning (every murder mystery, dark ones
// included); "classic" and "dark" split it.
const LIST_GENRES = ["murder-mystery", "classic", "dark", "kids", "adventure"] as const;
function matchesGenre(s: Story, genre?: (typeof LIST_GENRES)[number]): boolean {
  if (!genre) return true;
  const c = categoryOf(s);
  if (genre === "murder-mystery") return s.genre === "murder-mystery";
  if (genre === "classic") return c === "mystery";
  return c === genre;
}
const listLine = (s: Story) =>
  `${s.title} (slug: ${s.slug}; ${s.genre}${categoryOf(s) === "dark" ? ", dark" : ""}; ${s.players} players; about ${s.duration_minutes} minutes)`;

// open_plot_speaks: what the narrator can say when the user opens Plot Speaks without naming a story.
const OPEN_QUESTION = "Would you like to hear what stories there are, start one, or write your own?";
const OPEN_INTRO =
  "Plot Speaks is interactive mysteries and adventures: one narrator tells the story and plays every character, and you ask the questions and make the choices. " +
  "It's made for car rides, with nothing to look at. In a mystery the answer stays hidden, even from the narrator, until you accuse someone.";
function openMenu(all: Story[]): string {
  return CATEGORY_ORDER.map((c) => {
    const titles = all.filter((s) => categoryOf(s) === c).map((s) => s.title);
    if (!titles.length) return null;
    const more = titles.length > 3 ? `, and ${titles.length - 3} more` : "";
    return `- ${CATEGORY_NAMES[c]}: ${titles.slice(0, 3).join(", ")}${more}`;
  }).filter(Boolean).join("\n");
}

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

type Ctx = { db?: D1Database; tester: boolean; client: string | null; env: Env; ip: string };

// Built-in stories first, then approved submissions from D1 (same shape; secrets stay server-side).
async function catalog(ctx: Ctx): Promise<Story[]> {
  const extra = await loadApprovedStories(ctx.db);
  return extra.length ? [...STORIES, ...extra.filter((e) => !BUILTINS.slugs.has(e.slug))] : STORIES;
}

// Recording must never break play: failures are logged and swallowed.
async function record(ctx: Ctx, sql: string, ...args: unknown[]) {
  if (!ctx.db) return;
  try { await ctx.db.prepare(sql).bind(...args).run(); } catch (e) { log("db_error", { message: String(e) }); }
}

function createServer(ctx: Ctx) {
  const server = new McpServer(
    {
      name: "plot-speaks",
      title: "Plot Speaks",
      version: "0.4.0",
      description: "Interactive murder mysteries and adventures to play by voice with your assistant as the narrator, plus a studio for writing and submitting your own.",
      websiteUrl: "https://plotspeaks.com",
      icons: [{ src: "https://plotspeaks.com/icon-512.png", mimeType: "image/png", sizes: ["512x512"] }],
    },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "open_plot_speaks",
    {
      title: "Open Plot Speaks",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Call this first when the user opens or asks for Plot Speaks without naming a story (for example \"open Plot Speaks\" or \"let's play Plot Speaks\"). Returns a short spoken introduction, a question asking whether they'd like to hear the stories, start one or write their own, and a menu of story categories with example titles.",
      inputSchema: {},
    },
    async () => {
      const all = await catalog(ctx);
      log("open_plot_speaks", { stories: all.length });
      return text([
        `INTRO (to say aloud, in your own narrator voice):\n${OPEN_INTRO}`,
        `QUESTION (to ask next):\n${OPEN_QUESTION}`,
        `MENU (for when they want to hear the stories; one category at a time works best by voice):\n${openMenu(all)}`,
        "NEXT STEPS: to play a story they pick, call start_story with its title. For the full list, call list_stories (it takes a category). To write their own, call write_story.",
      ].join("\n\n"));
    },
  );

  server.registerTool(
    "list_stories",
    {
      title: "List stories",
      annotations: READ_ONLY,
      description: "List the Plot Speaks stories that can be played by voice, optionally for one category: murder mysteries (classic or dark), family mysteries for kids, and fantasy adventures. You don't need this to start a story the user named: call start_story directly.",
      // Optional inputs rather than none: one client called the input-less version before loading it.
      inputSchema: {
        genre: z.enum(LIST_GENRES).optional().describe("Only list this category: murder-mystery (all murder mysteries), classic (murder mysteries that aren't dark), dark (dark murder mysteries), kids (family mysteries) or adventure"),
        group_by_category: z.boolean().optional().describe("True to group the list under category headings"),
      },
    },
    async ({ genre, group_by_category }) => {
      log("list_stories", { genre: genre ?? null, grouped: Boolean(group_by_category) });
      const shown = (await catalog(ctx)).filter((s) => matchesGenre(s, genre));
      if (!group_by_category) return text(shown.map(listLine).join("\n") || "No stories in that category yet.");
      const groups = CATEGORY_ORDER.map((c) => {
        const inC = shown.filter((s) => categoryOf(s) === c);
        return inC.length ? `${CATEGORY_NAMES[c]}:\n${inC.map((s) => `- ${listLine(s)}`).join("\n")}` : null;
      }).filter(Boolean);
      const other = shown.filter((s) => !categoryOf(s));
      if (other.length) groups.push(`Other:\n${other.map((s) => `- ${listLine(s)}`).join("\n")}`);
      return text(groups.join("\n\n") || "No stories in that category yet.");
    },
  );

  server.registerTool(
    "start_story",
    {
      title: "Start a story",
      // Read-only for the story data; it also logs an anonymous play (no transcript, no personal data).
      annotations: READ_ONLY,
      description: "Load a Plot Speaks story to narrate. Returns the full story script, including the narrator's rules. Call it when the user asks to play a story.",
      inputSchema: { slug: z.string().describe("The story's slug or title, e.g. example-dinner-party or The Last Toast") },
    },
    async ({ slug }) => {
      const all = await catalog(ctx);
      const s = findStory(slug, all);
      log("start_story", { slug, found: s?.slug ?? null });
      if (!s) return text(`No story called "${slug}". Available: ${all.map((x) => `${x.title} (${x.slug})`).join(", ")}.`);
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
      title: "Check an accusation",
      // Read-only for the story data; it also logs an anonymous accusation event for the play.
      annotations: READ_ONLY,
      description: "Check a formal accusation in a Plot Speaks mystery. Call only after the user says they accuse someone. Returns that person's verdict line, starting Correct. or Innocent.",
      inputSchema: {
        slug: z.string().describe("The story slug"),
        accused: z.string().describe("The name of the person the user accused"),
        play_id: z.string().optional().describe("The play id from start_story"),
      },
    },
    async ({ slug, accused, play_id }) => {
      const s = findStory(slug, await catalog(ctx));
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
      title: "Get a scene cue",
      annotations: READ_ONLY,
      description: "Get a cue in a Plot Speaks adventure, when the story calls for one. Returns the text to narrate plus narrator-only notes that must never be read aloud.",
      inputSchema: {
        slug: z.string().describe("The story slug"),
        cue: z.string().describe("The cue id, e.g. S1 or S3b"),
        play_id: z.string().optional().describe("The play id from start_story"),
      },
    },
    async ({ slug, cue, play_id }) => {
      const s = findStory(slug, await catalog(ctx));
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
      title: "Rate a story",
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
      const s = findStory(slug, await catalog(ctx));
      log("rate_story", { slug, story: s?.slug ?? null, stars, spoiled: spoiled ?? null });
      if (!s) return text(`No story called "${slug}".`);
      await record(ctx, "INSERT INTO ratings (play_id, story, stars, spoiled, comment, at) VALUES (?, ?, ?, ?, ?, ?)", play_id ?? null, s.slug, stars, spoiled === undefined ? null : spoiled ? 1 : 0, comment ?? null, Date.now());
      return text("Thanks, rating saved.");
    },
  );

  // ------------------------------------------------------------ Story Studio (read side, M4)
  server.registerPrompt(
    "story_template",
    {
      title: "Write a Plot Speaks story",
      description: "Interview the writer, then write story.md and secrets.md in the Plot Speaks format, and check them with check_story.",
      argsSchema: z.object({
        genre: z.enum(GENRES).optional().describe("murder-mystery (default), kids, or adventure"),
        length: z.enum(LENGTHS).optional().describe("20 or 30 (minutes, one chapter; default 30), or 2-chapter"),
      }),
    },
    ({ genre, length }) => {
      log("story_template", { genre: genre ?? null, length: length ?? null });
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: storyTemplate(genre, length) } }] };
    },
  );

  server.registerTool(
    "check_story",
    {
      title: "Check a story draft",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Check a draft Plot Speaks story against the format rules (front matter, GM instructions, spoken intro, chapters and recap blocks, read-aloud length, no audio cues, protected names; with secrets_md, also cues and the Correct./Innocent. verdict lines). Returns ERROR and WARN lines with line numbers. Nothing submitted is stored.",
      inputSchema: {
        story_md: z.string().max(60000).describe("The full text of story.md"),
        secrets_md: z.string().max(60000).optional().describe("The full text of secrets.md, if written"),
        slug: z.string().max(64).optional().describe("The story's folder name, e.g. the-last-toast; checks that name is plotspeaks-<slug>"),
      },
    },
    async ({ story_md, secrets_md, slug }) => {
      const { report, errors, warnings } = checkSubmitted(story_md, secrets_md, slug);
      // Counts only: never the submitted text, title or slug.
      log("check_story", { story_chars: story_md.length, secrets_chars: secrets_md?.length ?? 0, errors, warnings });
      return text(report);
    },
  );

  server.registerTool(
    "write_story",
    {
      title: "Write a story",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Start writing a Plot Speaks story with the user. Returns a short intro for the user (how a story is built: a public story.md plus a private answer key, secrets.md; that you draft it together; that a person at Plot Speaks reviews it before anything is published; roughly how long it takes), a suggested step-by-step way to work together, and the format template. Call it when the user wants to write their own story.",
      inputSchema: {
        genre: z.enum(WRITE_GENRES).optional().describe("murder-mystery (default), dark (a dark murder mystery), kids (a family mystery; nobody gets hurt) or adventure"),
        length: z.enum(LENGTHS).optional().describe("20 or 30 (minutes, one chapter; default 30), or 2-chapter"),
      },
    },
    async ({ genre, length }) => {
      log("write_story", { genre: genre ?? null, length: length ?? null });
      return text(writeStory(genre, length));
    },
  );

  server.registerTool(
    "review_story",
    {
      title: "Review a story draft",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Review a draft Plot Speaks story before it is submitted. Runs the automatic format checks on story.md and secrets.md together (including whether story.md gives the culprit away) and returns a status (passes format checks, or the number of problems), the findings with line numbers, and a fair-play checklist for you to go through with the writer, since the server can't judge fairness itself. Nothing sent is stored.",
      inputSchema: {
        story_md: z.string().min(1).max(60000).describe("The full text of story.md"),
        secrets_md: z.string().max(60000).describe("The full text of secrets.md (the private answer key)"),
      },
    },
    async ({ story_md, secrets_md }) => {
      const r = reviewStory(story_md, secrets_md);
      // Counts only: never the submitted text, title or slug.
      log("review_story", { story_chars: story_md.length, secrets_chars: secrets_md.length, errors: r.errors, warnings: r.warnings });
      return text(r.report);
    },
  );

  // ------------------------------------------------------------ Story Studio (submit, M5)
  server.registerTool(
    "submit_story",
    {
      title: "Submit a story",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Submit a finished Plot Speaks story for publication, credited to the name the writer chooses. Runs the format checks (any error refuses it), an automatic safety screen and a daily limit, then stores it for a person to review. Nothing is public until it is approved. The receipt includes a claim code, shown once, that the writer needs to withdraw or update the story later. Call only when the writer has said they are ready to submit. To send a new version of an earlier submission, include replaces_id and claim_code.",
      inputSchema: {
        story_md: z.string().min(1).max(60000).describe("The full text of story.md"),
        secrets_md: z.string().max(30000).optional().describe("The full text of secrets.md (kept private on the server; mysteries need one)"),
        author_name: z.string().min(2).max(60).describe("The name to credit publicly as \"Written by\" (2 to 60 characters; a pen name is fine). Ask the writer; it is checked by the reviewer with the story."),
        contact: z.string().max(200).optional().describe("Optional: how the reviewer can reach the writer (email or handle). Seen only by the reviewer."),
        replaces_id: z.string().max(40).optional().describe("Only to update an earlier submission: its submission id"),
        claim_code: z.string().max(40).optional().describe("Only to update an earlier submission: the claim code from its receipt"),
      },
    },
    async (args) => text(await submitStory(ctx.env, ctx.ip, BUILTINS, args)),
  );

  server.registerTool(
    "withdraw_submission",
    {
      title: "Withdraw a submission",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: "Withdraw a story the user submitted to Plot Speaks: deletes the submission (pending or published) when the submission id and claim code from its receipt match. Call only when the writer asks to withdraw it.",
      inputSchema: {
        id: z.string().min(1).max(40).describe("The submission id from the receipt"),
        claim_code: z.string().min(1).max(40).describe("The claim code from the receipt, e.g. ABCD-EFGH-JKMN"),
      },
    },
    async ({ id, claim_code }) => text(await withdrawSubmission(ctx.env, { id, claim_code })),
  );

  return server;
}

type Env = SubEnv;

// ------------------------------------------------------------------ passenger page API
// JSON for the site's public passenger page (for players who paste the story into a chat with no
// connector). Each endpoint does what reveal or get_cue does, one answer at a time, and logs the
// same way with app "passenger-page":
//   GET /api/stories/<slug>/names           {"names": [...]}            Endings detail names only
//   GET /api/stories/<slug>/check?name=<n>  {"verdict", "line"}          one ending line (fuzzy match)
//   GET /api/stories/<slug>/cue/<id>        {"read_aloud": "..."}       never the narrator-only part
//   GET /api/stories/<slug>/listen          {"follow_ups": [{when, cue}]} the Listen-for table, so a passenger knows when to call S2b etc.
// Unknown slug, cue or name: 404 JSON. Slugs match exactly (the page links them), not fuzzily.
const PASSENGER = "passenger-page";
const apiJson = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

async function handlePassengerApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const m = /^\/api\/stories\/([a-z0-9-]+)\/(names|check|listen|cue\/([A-Za-z0-9]+))\/?$/.exec(url.pathname);
  if (!m) return url.pathname.startsWith("/api/") ? apiJson({ error: "not_found" }, 404) : null;
  if (request.method !== "GET" && request.method !== "HEAD") return apiJson({ error: "method_not_allowed" }, 405);
  const [, slug, what, cueId] = m;
  const s = STORIES.find((x) => x.slug === slug) ?? (await loadApprovedStories(env.DB)).find((x) => x.slug === slug && !BUILTINS.slugs.has(x.slug));
  if (!s) return apiJson({ error: "unknown_story" }, 404);
  const db = env.DB;
  const recordEvent = async (sql: string, ...args: unknown[]) => {
    if (!db) return;
    try { await db.prepare(sql).bind(...args).run(); } catch (e) { log("db_error", { message: String(e) }); }
  };
  if (what === "names") {
    log("passenger_names", { app: PASSENGER, story: s.slug });
    // Sorted, so the order in secrets.md (often the culprit first) gives nothing away.
    return apiJson({ names: s.endings.map((e) => e.name).sort((a, b) => a.localeCompare(b)) });
  }
  if (what === "listen") {
    // The wrangler-only "Listen for" table: what to listen for, and which follow-up cue to call then.
    const rows = (s.listen_for ?? "").split(/\r?\n/)
      .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
      .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
      .filter((r) => r.length >= 2 && !/^when you hear/i.test(r[0]))
      .map(([when, say]) => ({ when, cue: ((/S\d+[a-z]?/i.exec(say) ?? [say])[0]).replace(/^s/, "S") }));
    log("passenger_listen", { app: PASSENGER, story: s.slug, rows: rows.length });
    return apiJson({ follow_ups: rows });
  }
  if (what === "check") {
    const accused = (url.searchParams.get("name") ?? "").trim().slice(0, 120);
    if (!accused) return apiJson({ error: "missing_name" }, 400);
    const e = findEnding(s.endings, accused);
    log("reveal", { app: PASSENGER, slug, accused, story: s.slug, matched: e?.name ?? null, verdict: e?.verdict ?? null });
    if (!e) return apiJson({ error: "no_match", names: s.endings.map((x) => x.name).sort((a, b) => a.localeCompare(b)) }, 404);
    await recordEvent("INSERT INTO play_events (play_id, story, kind, detail, verdict, at, app) VALUES (NULL, ?, 'accusation', ?, ?, ?, ?)", s.slug, e.name, e.verdict, Date.now(), PASSENGER);
    return apiJson({ verdict: e.verdict === "correct" ? "correct" : "wrong", line: e.text });
  }
  const id = cueId.toUpperCase().startsWith("S") ? cueId.toUpperCase() : `S${cueId.toUpperCase()}`;
  const c = s.cues[id];
  log("get_cue", { app: PASSENGER, slug, cue: id, found: Boolean(c) });
  if (!c) return apiJson({ error: "unknown_cue" }, 404);
  await recordEvent("INSERT INTO play_events (play_id, story, kind, detail, at, app) VALUES (NULL, ?, 'cue', ?, ?, ?)", s.slug, id, Date.now(), PASSENGER);
  return apiJson({ read_aloud: c.read_aloud });
}

// Constant-time comparison, so the key can't be guessed from response timing.
function sameKey(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    // Plain http reaches the custom domain too, and the site builds its "Connect to Claude" link from
    // the request's origin; Claude refuses an http connector URL (Ben, 2026-10-16). Send everyone to https.
    if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    // plotspeaks.com is the home (Ben bought it 2026-10-16). The old address and www redirect there,
    // except the old /mcp, which keeps answering: connectors added before the move post to it, and
    // MCP clients don't reliably follow a redirect on POST.
    if (url.hostname === "www.plotspeaks.com" || (url.hostname === "plotspeaks.volocent.com" && url.pathname !== "/mcp")) {
      return Response.redirect(`https://plotspeaks.com${url.pathname}${url.search}`, 301);
    }
    // Review queue and cover generation: key-gated, 404 when no admin key is configured.
    const admin = await handleAdmin(request, env, BUILTINS);
    if (admin) return admin;
    // Covers for built-in stories are static assets (public/covers/), matched before the Worker
    // runs. A request that reaches here is for an approved submission's cover, kept in D1.
    const coverPath = /^\/covers\/([a-z0-9-]+)\.jpg$/.exec(url.pathname);
    if (coverPath && (request.method === "GET" || request.method === "HEAD")) {
      return (await serveSubmissionCover(env.DB, coverPath[1])) ?? new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain" } });
    }
    // The passenger page's answer-key endpoints (public, one answer at a time, like reveal/get_cue).
    const api = await handlePassengerApi(request, env);
    if (api) return api;
    // The catalog pages are public: they show only public story text (see site.ts). The access
    // key below applies to the MCP endpoint only.
    if (url.pathname !== "/mcp") {
      // Approved submissions join the catalog in the same public-only shape (slug + story.md text).
      const approved = await listApprovedSubmissions(env.DB);
      const site = await handleSite(request, approved.length ? [...PUBLIC_STORIES, ...approved.filter((a) => !BUILTINS.slugs.has(a.slug))] : PUBLIC_STORIES, env.DB);
      if (site) return site;
    }
    // Dev lock (Ben, 2026-10-15): until real sign-in arrives in M5, the dev server answers only
    // requests carrying the shared key, sent by the Claude connector as a request header.
    // No OAuth here: sign-in discovery URLs answer 404, which clients read as "no sign-in".
    if (url.pathname.startsWith("/.well-known/")) return new Response("Not found\n", { status: 404 });
    // The handshake (initialize, the tool list, pings) is answered without the key, so a client's
    // pre-check can see that this server has no sign-in. Anything that touches a story (tools/call,
    // resources, prompts) still needs the key.
    const OPEN_METHODS = new Set(["initialize", "notifications/initialized", "tools/list", "ping"]);
    let openHandshake = false;
    if (request.method === "POST") {
      try {
        const body = await request.clone().json();
        const msgs = Array.isArray(body) ? body : [body];
        openHandshake = msgs.length > 0 && msgs.every((m) => m && typeof m.method === "string" && OPEN_METHODS.has(m.method));
      } catch { openHandshake = false; }
    }
    // Claude's connector form only accepts approved header names, so the key is read from the
    // standard places: X-API-Key, or Authorization: Bearer <key>.
    const presented = request.headers.get("x-api-key") ?? (/^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "") || [])[1] ?? "";
    if (env.DEV_ACCESS_KEY && !openHandshake && !sameKey(presented.trim(), env.DEV_ACCESS_KEY)) {
      log("rejected", { reason: "missing or wrong access key" });
      // 403, not 401: MCP clients treat a 401 as "start an OAuth sign-in", and this server has none.
      return new Response("Forbidden: missing or wrong access key. Add it under the connector's Request headers as X-API-Key (or Authorization: Bearer <key>).\n", { status: 403, headers: { "content-type": "text/plain" } });
    }
    // Plays made with the access key are ours (testers); Gate 2 counts strangers only.
    const tester = Boolean(env.DEV_ACCESS_KEY) || Boolean(presented);
    const client = (request.headers.get("user-agent") ?? "").slice(0, 80) || null;
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    return createMcpHandler(() => createServer({ db: env.DB, tester, client, env, ip }))(request, env, ctx);
  },

  // Daily Cron Trigger (wrangler.jsonc "triggers"): 90-day log retention, see src/retention.ts.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runRetention(env.DB)
        .then((counts) => log("retention", counts))
        .catch((e) => log("retention_error", { message: String(e).slice(0, 200) })),
    );
  },
} satisfies ExportedHandler<Env>;
