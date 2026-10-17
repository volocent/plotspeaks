// Plot Speaks play server and Story Studio (Phase 2).
//
// A stateless MCP server (Streamable HTTP at /mcp), the catalog site (site.ts), the passenger
// page's JSON API, and the key-gated admin pages (submissions.ts). Tools:
//   play:   open_plot_speaks, list_stories, start_story, check_accusation, reveal_solution,
//           get_cue, rate_story
//   studio: write_story, review_story, submit_story, withdraw_submission
//
// Answer keys never reach the assistant in bulk: check_accusation returns one suspect's line,
// get_cue one cue, and reveal_solution the full solution only after an accusation or when the
// player gives up. The served scripts are the connector versions built by
// tools/worker-data/build.mjs (no paste-play "wrangler" hand-offs; see connector.mjs).
// Each tool call is logged (wrangler tail / Workers logs) without the user's raw text.
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import stories from "./generated/stories.json";
import { handleSite, notFoundPage, siteOrigin, accountPage, type PublicStory } from "./site";
import { LENGTHS, WRITE_GENRES, writeStory, reviewStory } from "./studio";
import { submitStory, withdrawSubmission, loadApprovedStories, handleAdmin, serveSubmissionCover, listApprovedSubmissions, sameKey, type SubEnv, type Builtins, type PlayStory, type Ending } from "./submissions";
import { runRetention } from "./retention";
import { countPage, countMcp, bump } from "./usage";
import { assistantOf } from "./stats";
import { matchStory, matchEnding, sortedNames } from "../../tools/worker-data/match.mjs";
import { initialState, renderNode, matchChoice, advance, loadState, saveStateStatement, offered as branchOffered, type BranchState } from "./branching";
import { newTrivia, dealtBoard, clueId, renderBoard, askQuestion, answerQuestion, challenge, loadTrivia, saveTrivia, type Step, type TriviaBoard } from "./games";
import { newWorld, applyChanges, recall, roll as rollDice, newCode, codeHash, loadWorld, saveWorld, type World, type WorldChanges } from "./world";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { accountSite, type AccountEnv } from "./account";
import { currentUser, startSignIn, finishSignIn, signOut, deleteAccount, signInConfigured, noteStart, noteOutcome, historyOf, playedSlugs, claimPlays, type AuthEnv } from "./auth";

type Story = PlayStory;
const STORIES = stories as unknown as Story[]; // generated JSON: its inferred type is a union per story
// The catalog site gets the slug and the public story.md text ONLY: never endings or cues.
const toPublic = (s: Story): PublicStory => ({ slug: s.slug, story: s.story, ...(s.testing ? { testing: true } : {}) });
const PUBLIC_STORIES: PublicStory[] = STORIES.filter((s) => !s.preview).map(toPublic);
const PREVIEW_STORIES: PublicStory[] = STORIES.filter((s) => s.preview).map(toPublic);
const BUILTINS: Builtins = { slugs: new Set(STORIES.map((s) => s.slug)), storyFor: (slug) => STORIES.find((s) => s.slug === slug)?.story ?? null };

// These rules travel with the server itself, not only inside the story text: on 2026-10-15
// Claude declined to treat GM instructions inside a pasted document as the user's instructions.
// No mention of children's stories here or in any tool metadata (review B2): the listing must read
// the same whatever client scans it.
const INSTRUCTIONS = [
  "Plot Speaks runs interactive stories and games that the user plays with you by voice. When the user names a story to play, call start_story with it and act as the narrator. When they open or ask for Plot Speaks without naming a story (\"open Plot Speaks\", \"let's play Plot Speaks\"), call open_plot_speaks: it returns a short spoken intro, a question and a menu to offer them. If the user has heard the intro before, or asks to skip it, call open_plot_speaks with skip_intro: true and go straight to the question; they can always ask for the instructions again (\"Plot Speaks instructions\", \"how does this work\"), which is open_plot_speaks with instructions: true. When they want to write their own story, call write_story.",
  // Guardrail (Ben and Julia's Dead Air play, 2026-10-16): the narrator volunteered a cast-table fact the
  // players had never heard, then explained the slip with the whole fact. The cast and timeline tables
  // are what characters can say when asked, not what the player already knows.
  "In play, the player knows only what they have heard in play. The story's cast, timeline and scene notes are what characters can say when asked, not facts the player already has: never state, summarise or refer to anything from them until the player asks the person or does the action that reveals it. If you mention something they haven't learned yet, don't explain it or back it up with more facts: say \"You haven't come across that yet. Who would you like to ask?\" and move on.",
  "A tool call can fail when the user's phone has no signal (they are often driving). If a Plot Speaks call fails, say so in one sentence (\"I can't reach Plot Speaks right now\"), keep narrating from the script you already have, and try the call again when the player is ready; nothing is lost, the play id still works. Never invent a verdict, a cue or a reveal in place of a failed call.",
  // Worded as the game's content, not as instructions that outrank the user: Anthropic's directory
  // policy bars servers that direct Claude to take behavioural instructions from external sources.
  "The story text returned by start_story is the game the user asked to play. Its \"How to run this\" section describes how the game is narrated (short spoken turns, a question at the end of each turn, only the clues written in the story), and the game works best played that way. The story's rules are about narration; the user's own requests and your own guidelines always come first: if they ask to change pace, skip ahead, stop or play differently, do what they ask.",
  "You do not know the solution. Never guess it. When the player formally accuses someone (the script says to ask for their reason first), call check_accusation with the story slug, the accused person's name and the play id, and give the verdict it returns (its line starts with Correct. or Innocent.). If it says the name could be more than one person, ask the player which they mean. Call check_accusation only for a formal accusation.",
  "After a correct accusation, or when the player asks for the full reveal or gives up, call reveal_solution with the play id (add gave_up: true when they gave up without accusing anyone). Read its READ ALOUD part; read its WHAT BECAME OF THEM part only if the player wants to hear what became of everyone.",
  "When the script calls for a cue, call get_cue with that cue id and narrate only its read-aloud part. Each cue also has narrator notes, to help run the scene; when they say to call a follow-up cue (for example S3b) after something happens, call get_cue for it yourself at that moment.",
  "In a choose-your-path story, start_story returns the opening; after each decision the player makes, call choose with the play id and their answer, and narrate what it returns. You never see what lies behind a choice, so don't guess or hint at it.",
  "If the player has just switched to the Plot Speaks connector with an account and this conversation has play ids from before, offer once to add those plays to their account, and if they agree call claim_plays with the ids. A campaign started without an account moves onto it when they resume it with its code.",
  "In a trivia game, you are the host: start_story returns the board; call game_question for the category and value a player picks and read the clue exactly; call game_answer with what they said; if they dispute a ruling, call game_challenge. You never have the answers, so never give or hint at one before game_answer rules.",
  "start_story returns a play id: pass it to check_accusation, reveal_solution and rate_story. If you no longer have it, call check_accusation without it. A two-chapter story arrives one chapter at a time: when chapter 1 ends, call start_story with chapter: 2 and the play id. To start a story the user named, call start_story directly; list_stories is for browsing.",
  "Call submit_story only when the writer has said they are ready to submit, and withdraw_submission only when they ask to withdraw. Ask the writer which name to credit.",
  "Writing: write_story returns a suggested step-by-step way to draft a story with the user, and the format template. review_story checks a draft (format rules, plus a fair-play checklist for you to go through). When the writer wants to share it, submit_story sends it, with the name they want credited, to a person who reviews every submission before it is published; withdraw_submission removes it again with the claim code from the receipt.",
  "When a story ends (a correct accusation, the full reveal, a victory or defeat), ask once: \"Would you like to leave feedback? How many stars out of five would you give the story, did I give anything away too early, and is there anything you'd tell the people who make Plot Speaks?\" Then call rate_story with the stars, the spoiled answer, any comment about the story and any feedback about the experience, with the play id. If the player doesn't want to, drop it. Either way, end with: \"Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or play this one again?\" Main menu is open_plot_speaks with skip_intro: true; again is start_story for the same story (a new play).",
].join("\n");

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
// Not-found and invalid results are marked as errors (review S16), with the actionable text kept.
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

// Kinds (docs/PLAN-INTERACTIVE-2026-10-16.md section 2): what the player does, the top level of the
// catalogue, the welcome menu and the site's shelves. Inside the mystery kind, the older categories
// (classic, dark, family) still filter list_stories. kind and audience are read at build time.
const KIND_ORDER = ["mystery", "adventure", "branching", "trivia", "game", "campaign"] as const;
type KindId = (typeof KIND_ORDER)[number];
const KIND_NAMES: Record<KindId, string> = { mystery: "Mysteries", adventure: "Adventures", branching: "Choose your path", trivia: "Trivia", game: "Games", campaign: "Campaigns" };
const kindOfStory = (s: Story): KindId => ((KIND_ORDER as readonly string[]).includes(s.kind) ? s.kind as KindId : "mystery");
const isFamilyStory = (s: Story) => s.audience === "family" || s.genre === "kids";
type CategoryId = "mystery" | "dark" | "kids" | "adventure";
// metadata.tone is read once, at build time (build.mjs) or when an approved submission is loaded.
function categoryOf(s: Story): CategoryId | null {
  if (kindOfStory(s) === "mystery") return isFamilyStory(s) ? "kids" : s.tone === "dark" ? "dark" : "mystery";
  if (kindOfStory(s) === "adventure") return "adventure";
  return null;
}
const isMystery = (s: Story) => s.endings.length > 0 || kindOfStory(s) === "mystery";
// list_stories genre filter. "murder-mystery" keeps its old meaning (every murder mystery, dark ones
// included); "classic" and "dark" split it. "kids" exists only outside ChatGPT (OpenAI's plugin rules).
const LIST_GENRES = ["murder-mystery", "classic", "dark", "kids", "adventure"] as const;
const LIST_GENRES_GPT = ["murder-mystery", "classic", "dark", "adventure"] as const;
const WRITE_GENRES_GPT = ["murder-mystery", "dark", "adventure", "branching", "trivia", "game"] as const;
function matchesGenre(s: Story, genre?: (typeof LIST_GENRES)[number]): boolean {
  if (!genre) return true;
  const c = categoryOf(s);
  if (genre === "murder-mystery") return s.genre === "murder-mystery";
  if (genre === "classic") return c === "mystery";
  return c === genre;
}
const listLine = (s: Story) =>
  `${s.title} (slug: ${s.slug}; ${KIND_NAMES[kindOfStory(s)].toLowerCase()}${categoryOf(s) === "dark" ? ", dark" : ""}${isFamilyStory(s) ? ", for families" : ""}; ${s.players} players; about ${s.duration_minutes} minutes${s.testing ? "; new, being tested" : ""})`;

// open_plot_speaks: what the narrator can say when the user opens Plot Speaks without naming a story.
const OPEN_QUESTION = "Would you like to hear what stories there are, start one, or write your own?";
const ACCOUNT_NOTE = "plotspeaks.com/account";
const OPEN_INTRO =
  "Plot Speaks is interactive stories and games you play out loud: one narrator tells the story and plays every character, and you ask the questions and make the choices. " +
  "It's made for car rides, with nothing to look at. In a mystery the answer stays hidden, even from the narrator, until you accuse someone. " +
  "Say \"Plot Speaks, pause\" any time, and \"Plot Speaks instructions\" to hear this again.";
const OPEN_HOW =
  "HOW IT WORKS (say in your own words, one or two beats per turn):\n" +
  "- One narrator, short spoken turns, a question at the end of each; you answer by talking.\n" +
  "- Mysteries: talk to people, look around, and accuse someone when you're sure. The answer stays hidden until then; one wrong accusation is allowed.\n" +
  "- Adventures: explore, choose, and roll when the narrator asks; hidden scenes arrive when you reach them.\n" +
  "- Phrases: \"Plot Speaks, pause\" to stop, \"Plot Speaks, resume\" for a recap, \"Plot Speaks, shorter\" if the narrator rambles, \"Plot Speaks, wrap it up\" to finish early.\n" +
  "- No signal? The story keeps going from what the narrator already has; checks are retried when you're back in range.\n" +
  "- At the end you can leave feedback: stars, whether anything was given away, and anything you'd tell the makers.";
// One line per kind that has anything in it; a mystery line says when some are dark or for families.
function openMenu(all: Story[]): string {
  return KIND_ORDER.map((k) => {
    // Family titles go last, so the examples read aloud are the general ones.
    const inK = all.filter((s) => kindOfStory(s) === k).sort((a, b) => Number(isFamilyStory(a)) - Number(isFamilyStory(b)));
    if (!inK.length) return null;
    const titles = inK.map((s) => s.title);
    const more = titles.length > 3 ? `, and ${titles.length - 3} more` : "";
    const notes = [inK.some((s) => categoryOf(s) === "dark") ? "some dark" : "", inK.some(isFamilyStory) ? "some for families" : ""].filter(Boolean);
    return `- ${KIND_NAMES[k]}${notes.length ? ` (${notes.join(", ")})` : ""}: ${titles.slice(0, 3).join(", ")}${more}`;
  }).filter(Boolean).join("\n");
}

// A short preface for the served script. The script itself is the connector version, built at
// build time (tools/worker-data/connector.mjs), so nothing here depends on rewriting it.
const prefaceFor = (s: Story) =>
  "## Playing through the Plot Speaks connector\n" +
  (s.branches
    ? "This is a choose-your-path story. The story itself stays on the Plot Speaks server and arrives one moment at a time: the opening is below, and after each choice the player makes, call choose with the play id and their answer to get what happens next. You don't know what lies behind any choice, so never guess or hint at it. \"Plot Speaks, resume\" is choose with no answer: it returns where they are.\n\n"
    : isMystery(s)
    ? "The answer key stays on the Plot Speaks server, so you don't know the solution. When the player formally accuses someone, call check_accusation and give the verdict it returns. When they give up or ask for the full reveal, call reveal_solution.\n\n"
    : kindOfStory(s) === "game" ? "The rules below are the whole game; you run it as written.\n\n"
    : kindOfStory(s) === "campaign" ? "This is a campaign: you improvise from the world seed below, and Plot Speaks keeps the books. Roll every check, attack and save with roll and say the result as rolled. Record what happens with world_update the moment it happens, and obey what it refuses. In a later session the players give their resume code: call start_story with it as resume_code.\n\n"
    : kindOfStory(s) === "trivia" ? "This is a trivia game: you host it, and Plot Speaks holds every clue and answer.\n\n"
    : "The hidden scenes stay on the Plot Speaks server. When the script calls for a cue, call get_cue and narrate its read-aloud part.\n\n") +
  "**What the player knows.** Only what they have heard in play. The cast table, the timeline and the scene notes below are what characters can say when asked and what places hold when searched, not facts the player already has. Never state, summarise or refer to any of it until the player asks the person or does the action that reveals it. If you mention something they haven't learned yet, don't explain it or add to it: say \"You haven't come across that yet. Who would you like to ask?\" and go on.\n\n" +
  "**No signal.** If a Plot Speaks call fails, say so in one sentence, keep narrating from this script, and try again when the player is ready; the play id still works. Never invent a verdict, a cue or a reveal.\n\n" +
  (s.testing
    ? "**This one is new and being tested.** Say so in one short sentence before you begin. At the end, when you ask for feedback, ask especially how it worked for them: anything confusing, anything that didn't work, what they enjoyed. Pass it to rate_story as feedback in their words.\n\n"
    : "");

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }));

// Annotations. "Records" tools write an anonymous play event (no transcript, no personal data);
// the read-only ones change nothing (the per-day request tally in usage.ts is server telemetry).
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RECORDS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

// chatgpt: the request came from ChatGPT (its User-Agent, or openai/* keys in a tools/call _meta).
// userId: the signed-in person on the account connector; null on the open one.
type Ctx = { db?: D1Database; tester: boolean; client: string | null; chatgpt: boolean; env: Env; ip: string; userId: string | null };

// Built-in stories first, then approved submissions from D1 (same shape; secrets stay server-side).
async function allStories(ctx: Ctx): Promise<Story[]> {
  const extra = await loadApprovedStories(ctx.db);
  return extra.length ? [...STORIES, ...extra.filter((e) => !BUILTINS.slugs.has(e.slug))] : STORIES;
}
// OpenAI's plugin rules bar anything that targets children under 13, so the family stories are
// not offered to ChatGPT (Ben, 2026-10-16, option B). They stay on the site and in other assistants.
const visibleTo = (ctx: Ctx, all: Story[]) => (ctx.chatgpt ? all.filter((s) => !isFamilyStory(s)) : all);
async function catalog(ctx: Ctx): Promise<Story[]> {
  return visibleTo(ctx, (await allStories(ctx)).filter((s) => !s.preview));
}
// A preview story matches only its exact slug or title (with or without a leading "the").
const exactName = (s: string) => s.toLowerCase().replace(/[^a-z0-9 -]+/g, "").replace(/^the /, "").trim();
const previewMatch = (all: Story[], asked: string) =>
  all.find((s) => s.preview && (s.slug === asked.trim().toLowerCase() || exactName(s.title) === exactName(asked)));
const titleList = (list: Story[]) => [...list].sort((a, b) => a.title.localeCompare(b.title)).map((x) => `${x.title} (${x.slug})`).join(", ");

// Resolves a spoken title or slug to a story, failing closed (review B2/S2). For ChatGPT the match
// is made against the whole catalog, so a family title never falls through to a similar-sounding
// story; it answers "isn't available" instead.
async function resolveStory(ctx: Ctx, slug: string): Promise<{ s: Story; error?: undefined } | { s?: undefined; error: string }> {
  const all = await allStories(ctx);
  const visible = visibleTo(ctx, all);
  const preview = previewMatch(all, slug);
  const m = (preview ? { story: preview } : matchStory(slug, all.filter((s) => !s.preview))) as { story: Story | null; candidates?: Story[] };
  if (m.story && ctx.chatgpt && isFamilyStory(m.story)) {
    return { error: `That story isn't available in ChatGPT. Stories you can play here include: ${titleList(visible)}.` };
  }
  if (m.story) return { s: m.story };
  const near = (m.candidates ?? []).filter((x) => visible.includes(x));
  const shown = String(slug).slice(0, 80);
  return { error: near.length ? `No story called "${shown}". Did you mean: ${titleList(near)}?` : `No story called "${shown}". The stories are: ${titleList(visible)}.` };
}

// Gate 2's permanent count (review S4): +1 the first time a stranger's play reaches an accusation,
// a rating or the full reveal, if the play is at least a minute old. completions' primary key makes
// it idempotent, and the totals bump only follows this request's own insert (matched by nonce), so a
// retried or concurrent call can't count twice. Both run in one db.batch (a D1 transaction).
const MIN_PLAY_MS = 60_000;
function completionStatements(db: D1Database, playId: string, slug: string): D1PreparedStatement[] {
  const nonce = crypto.randomUUID();
  const now = Date.now();
  return [
    db.prepare(`INSERT OR IGNORE INTO completions (play_id, at, nonce)
      SELECT p.id, ?, ? FROM plays p WHERE p.id = ? AND p.story = ? AND p.tester = 0 AND p.started_at <= ?`).bind(now, nonce, playId, slug, now - MIN_PLAY_MS),
    db.prepare(`INSERT INTO totals (key, n)
      SELECT 'completed_stranger_plays', 1 FROM completions WHERE play_id = ? AND nonce = ?
      ON CONFLICT(key) DO UPDATE SET n = n + 1`).bind(playId, nonce),
  ];
}

// A play id is only attached to an event when the play is this story's: a play id from story A
// sent with story B's accusation records an event for B with no play (and counts no completion),
// so one play can't earn reveal_solution's gate for another story.
const PLAY_OF = "(SELECT id FROM plays WHERE id = ? AND story = ?)";

// Recording must never break play: failures are logged and swallowed. If the completion
// statements fail (e.g. their table is missing), the event itself is still written.
async function recordBatch(ctx: Ctx, playId: string | null | undefined, slug: string, events: (db: D1Database) => D1PreparedStatement[]) {
  const db = ctx.db;
  if (!db) return;
  try {
    await db.batch([...(playId ? completionStatements(db, playId, slug) : []), ...events(db)]);
  } catch (e) {
    log("db_error", { message: String(e).slice(0, 200) });
    if (playId) {
      try { await db.batch(events(db)); } catch (e2) { log("db_error", { message: String(e2).slice(0, 200) }); }
    }
  }
}
async function record(ctx: Ctx, sql: string, ...args: unknown[]) {
  if (!ctx.db) return;
  try { await ctx.db.prepare(sql).bind(...args).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
}

const SLUG = z.string().min(2).max(80);
const PLAY_ID = z.string().min(1).max(40);

function createServer(ctx: Ctx) {
  const gpt = ctx.chatgpt;
  const server = new McpServer(
    {
      name: "plot-speaks",
      title: "Plot Speaks",
      version: "0.5.0",
      description: "Interactive stories and games to play by voice with your assistant as the narrator: murder mysteries and adventures today, plus a studio for writing and submitting your own.",
      websiteUrl: "https://plotspeaks.com",
      icons: [{ src: "https://plotspeaks.com/icon-512.png", mimeType: "image/png", sizes: ["512x512"] }],
    },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "open_plot_speaks",
    {
      title: "Open Plot Speaks",
      annotations: { ...READ_ONLY, title: "Open Plot Speaks" },
      description: "Returns the Plot Speaks welcome: a short spoken introduction, a question offering to list the stories, start one or write one, and a menu of story categories with example titles. With skip_intro the introduction is left out; with instructions it adds the how-to-play.",
      inputSchema: {
        skip_intro: z.boolean().optional().describe("True when the user has heard the introduction before or asks to skip it: returns only the question and the menu"),
        instructions: z.boolean().optional().describe("True when the user asks how Plot Speaks works or wants the instructions again: adds the how-to-play"),
      },
    },
    async ({ skip_intro, instructions }) => {
      const all = await catalog(ctx);
      log("open_plot_speaks", { stories: all.length, skip_intro: Boolean(skip_intro), instructions: Boolean(instructions), signed_in: Boolean(ctx.userId) });
      // A signed-in player who has played before: a welcome back, the intro skipped, and a few
      // things they haven't played yet.
      let back: string | null = null;
      if (ctx.userId) {
        const recent = await historyOf(ctx.db, ctx.userId, 3);
        if (recent.length) {
          const played = await playedSlugs(ctx.db, ctx.userId);
          const fresh = all.filter((s) => !played.has(s.slug)).slice(0, 3).map((s) => s.title);
          back = `WELCOME BACK (they've played before; skip the intro unless they ask): last time, ${recent[0].title}${recent[0].outcome ? ` (${recent[0].outcome})` : ""}.${fresh.length ? ` Not played yet: ${fresh.join(", ")}.` : ""} list_stories with not_played: true lists everything they haven't played.`;
        }
      }
      return text([
        back,
        (skip_intro || back) && !instructions ? null : `INTRO (to say aloud, in your own narrator voice):\n${OPEN_INTRO}`,
        instructions ? OPEN_HOW : null,
        `QUESTION (to ask next):\n${OPEN_QUESTION}`,
        `MENU (for when they want to hear the stories; one category at a time works best by voice):\n${openMenu(all)}`,
        "NEXT STEPS: to play a story they pick, call start_story with its title. For the full list, call list_stories (it takes a kind). To write their own, call write_story. If they ask for the instructions later, call open_plot_speaks with instructions: true.",
      ].filter(Boolean).join("\n\n"));
    },
  );

  server.registerTool(
    "list_stories",
    {
      title: "List stories",
      annotations: { ...READ_ONLY, title: "List stories" },
      description: "Lists the Plot Speaks stories and games that can be played by voice, with length and number of players, optionally for one kind (mysteries, adventures, choose-your-path stories, trivia, games, campaigns) or, within mysteries, classic or dark.",
      // Optional inputs rather than none: one client called the input-less version before loading it.
      inputSchema: {
        kind: z.enum(KIND_ORDER).optional().describe("Only list this kind: mystery, adventure, branching (choose your path), trivia, game or campaign"),
        genre: (gpt ? z.enum(LIST_GENRES_GPT) : z.enum(LIST_GENRES)).optional().describe(
          "Within mysteries and adventures: murder-mystery (all murder mysteries), classic (murder mysteries that aren't dark), dark (dark murder mysteries) or adventure"),
        group_by_category: z.boolean().optional().describe("True to group the list under kind headings"),
        not_played: z.boolean().optional().describe("True to leave out what this player has already played (signed-in players only)"),
      },
    },
    async ({ kind, genre, group_by_category, not_played }) => {
      log("list_stories", { kind: kind ?? null, genre: genre ?? null, grouped: Boolean(group_by_category), not_played: Boolean(not_played) });
      let shown = (await catalog(ctx)).filter((s) => (!kind || kindOfStory(s) === kind) && matchesGenre(s, genre));
      let note = "";
      if (not_played) {
        if (!ctx.userId) note = `\n\n(Plot Speaks can't tell what this player has played: they aren't signed in. With an account, at ${ACCOUNT_NOTE}, it remembers.)`;
        else {
          const played = await playedSlugs(ctx.db, ctx.userId);
          shown = shown.filter((s) => !played.has(s.slug));
          if (!shown.length) return text("They've played everything of that kind. Offer another kind, or a favourite again.");
        }
      }
      if (!group_by_category) return text((shown.map(listLine).join("\n") || "Nothing of that kind yet.") + note);
      const groups = KIND_ORDER.map((k) => {
        const inK = shown.filter((s) => kindOfStory(s) === k);
        return inK.length ? `${KIND_NAMES[k]}:\n${inK.map((s) => `- ${listLine(s)}`).join("\n")}` : null;
      }).filter(Boolean);
      return text((groups.join("\n\n") || "Nothing of that kind yet.") + note);
    },
  );

  server.registerTool(
    "claim_plays",
    {
      title: "Add earlier plays to my account",
      annotations: { ...RECORDS, title: "Add earlier plays to my account" },
      description: "For a player who has just signed in: adds plays they made earlier without an account (the play ids from this conversation) to their Plot Speaks history, with how each ended, and marks trivia questions they heard. Plays already on another account are left alone.",
      inputSchema: { play_ids: z.array(PLAY_ID).min(1).max(50).describe("Play ids from earlier in this conversation (start_story returned them)") },
    },
    async ({ play_ids }) => {
      if (!ctx.userId) return fail(`This player isn't signed in. To keep these plays, they add the connector with an account (${ACCOUNT_NOTE}), sign in, and ask again in this same conversation.`);
      const all = await allStories(ctx);
      const bySlug = new Map(all.map((s) => [s.slug, s]));
      const r = await claimPlays(ctx.db, ctx.userId, play_ids, (slug) => { const s = bySlug.get(slug); return s ? { title: s.title, kind: kindOfStory(s) } : null; });
      // Trivia: the clues already played in those games count as heard.
      for (const id of play_ids) {
        try {
          const play = ctx.db ? await ctx.db.prepare("SELECT story FROM plays WHERE id = ? AND user_id = ?").bind(id, ctx.userId).first<{ story: string }>() : null;
          const s = play ? bySlug.get(play.story) : undefined;
          if (!s?.trivia) continue;
          const st = await loadTrivia(ctx.db, id);
          if (st?.asked.length) await rememberClues(ctx, s.slug, dealtBoard(s.trivia, st), st.asked);
        } catch { /* best effort */ }
      }
      log("claim_plays", { asked: play_ids.length, claimed: r.claimed.length, skipped: r.skipped });
      const titles = [...new Set(r.claimed.map((slug) => bySlug.get(slug)?.title ?? slug))];
      return text(r.claimed.length
        ? `Added to their account: ${titles.join(", ")}.${r.skipped ? ` ${r.skipped} couldn't be added (not found, or already on another account).` : ""} Their history and "not played yet" now include them.`
        : "None of those plays could be added (not found, or already on another account).");
    },
  );

  server.registerTool(
    "my_history",
    {
      title: "What I've played",
      annotations: { ...READ_ONLY, title: "What I've played" },
      description: "Returns what a signed-in Plot Speaks player has played, newest first, with how each ended. Without an account it says how to get one.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("How many to list (default 15)") },
    },
    async ({ limit }) => {
      log("my_history", { signed_in: Boolean(ctx.userId) });
      if (!ctx.userId) return text(`This player isn't signed in, so Plot Speaks has no history for them. To have it remember, they can add the connector with an account (${ACCOUNT_NOTE}) and sign in with Google once. Everything works without it.`);
      const rows = await historyOf(ctx.db, ctx.userId, limit ?? 15);
      if (!rows.length) return text("Nothing played yet on this account.");
      return text(`PLAYED (newest first):\n${rows.map((r) => `- ${r.title} (${r.story}; ${KIND_NAMES[(KIND_ORDER as readonly string[]).includes(r.kind) ? r.kind as KindId : "mystery"].toLowerCase()}), ${new Date(r.started_at).toISOString().slice(0, 10)}: ${r.outcome ?? "not finished"}`).join("\n")}`);
    },
  );

  server.registerTool(
    "start_story",
    {
      title: "Start a story",
      // Not read-only: it logs an anonymous play (no transcript, no personal data). Directories reject
      // annotations that don't match behaviour.
      annotations: { ...RECORDS, title: "Start a story" },
      description: "Loads a Plot Speaks story by slug or title. Returns its script (setting, cast, scenes, and how the game is narrated; one chapter at a time for two-chapter stories) and a play id. Records an anonymous play.",
      inputSchema: {
        slug: SLUG.describe("The story's slug or title, e.g. example-dinner-party or The Last Toast"),
        chapter: z.number().int().min(1).max(9).optional().describe("For a two-chapter story: 2 to get chapter 2 (default 1)"),
        play_id: PLAY_ID.optional().describe("With chapter 2: the play id from chapter 1, to keep the same play"),
        resume_code: z.string().max(80).optional().describe("For a campaign: the three-word code from an earlier session, to carry on where it left off"),
        new_campaign: z.boolean().optional().describe("For a campaign, when the player is signed in and has one already: true to start a fresh one instead of carrying on"),
      },
    },
    async ({ slug, chapter, play_id, resume_code, new_campaign }) => {
      const r = await resolveStory(ctx, slug);
      log("start_story", { found: r.s?.slug ?? null, chapter: chapter ?? 1, resume: Boolean(resume_code) });
      if (!r.s) return fail(r.error);
      const s = r.s;
      // Carrying on a campaign: by its code, or, for a signed-in player, their latest one of this
      // story (unless they asked for a new one). The same play, its world, and the script.
      if (kindOfStory(s) === "campaign" && (resume_code || (ctx.userId && !new_campaign))) {
        const c = await campaignPlay(s.slug, undefined, resume_code);
        if ("error" in c && resume_code) return fail(c.error);
        if (!("error" in c)) return text(
          `You are the narrator for "${s.title}", carrying on a campaign${resume_code ? "" : " (found on their account; if they'd rather start over, call start_story with new_campaign: true)"}. Story slug: ${s.slug}. Play id: ${c.playId} (pass it to world_update, world_recall and rate_story).${resume_code ? ` The resume code stays "${resume_code.trim().toLowerCase()}".` : ""}\n\n` +
          `${prefaceFor(s)}${(s.story_connector?.[0]) ?? s.story}\n\n## Where the campaign stands\n${recall(c.w)}\n\nGive the players a short spoken recap of the story so far, then ask what they do.`,
        );
      }
      const n = chapter ?? 1;
      const parts = s.story_connector?.length ? s.story_connector : [s.story];
      if (n > parts.length) return fail(`"${s.title}" has ${parts.length === 1 ? "one chapter" : `${parts.length} chapters`}; call start_story without chapter to play it.`);
      // Chapter 2 of a play already under way keeps its play id; anything else is a new play.
      let playId: string | null = null;
      if (n > 1 && play_id && ctx.db) {
        try {
          const row = await ctx.db.prepare("SELECT story FROM plays WHERE id = ?").bind(play_id).first<{ story: string }>();
          if (row?.story === s.slug) playId = play_id;
        } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
      }
      if (!playId) {
        playId = crypto.randomUUID();
        await record(ctx, "INSERT INTO plays (id, story, client, tester, started_at, user_id) VALUES (?, ?, ?, ?, ?, ?)", playId, s.slug, ctx.client, ctx.tester ? 1 : 0, Date.now(), ctx.userId);
        await noteStart(ctx.db, ctx.userId, { play_id: playId, story: s.slug, title: s.title, kind: kindOfStory(s) });
      }
      const more = n < parts.length ? `, and to start_story with chapter: ${n + 1} for the next chapter` : "";
      // A choose-your-path story starts its state here and hands out the opening node only.
      let opening = "";
      if (kindOfStory(s) === "campaign") {
        // A new campaign: an empty world and a spoken resume code for the next session.
        const code = newCode();
        const w = { ...newWorld(), code: undefined };
        if (ctx.db) {
          try { await ctx.db.batch([saveWorld(ctx.db, playId, w), ctx.db.prepare("INSERT INTO campaign_codes (code_hash, play_id, created_at) VALUES (?, ?, ?)").bind(await codeHash(code), playId, Date.now())]); }
          catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
        }
        opening = `\n\n## This campaign\nRESUME CODE: "${code}". Tell the players now, and again at the end of every session: next time, in a new chat, they say "Continue my Plot Speaks campaign ${s.title}, code ${code}" and you call start_story with resume_code.\n\n${recall(w)}`;
      } else if (s.trivia) {
        // Deal this game's clues from the pools, avoiding ones a signed-in player has seen.
        const st = newTrivia(s.trivia, await seenClues(ctx, s.slug));
        if (ctx.db) {
          try { await saveTrivia(ctx.db, playId, st).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
        }
        opening = `\n\n## The board\n${renderBoard(dealtBoard(s.trivia, st), st)}`;
      } else if (s.picks?.length) {
        // One hidden pick per play, for the mode where the narrator thinks of something.
        const pick = s.picks[Math.floor(Math.random() * s.picks.length)];
        opening = `\n\n## Your secret pick (only for the mode where you think of something and the players guess)\nYour pick is: ${pick}. Never say it, hint at it beyond the rules, or put it in writing until the round ends. If they play the other mode, ignore it.`;
      }
      if (s.branches) {
        const st = initialState(s.branches);
        if (ctx.db) {
          try { await saveStateStatement(ctx.db, playId, st).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
        }
        opening = `\n\n## The opening\n${renderNode(s.branches, st, { title: s.title })}`;
      }
      const passTo = kindOfStory(s) === "campaign" ? "world_update, world_recall and rate_story" : s.branches ? `choose and rate_story` : s.trivia ? "game_board, game_question, game_answer, game_challenge and rate_story" : kindOfStory(s) === "game" ? "rate_story" : `check_accusation, reveal_solution and rate_story${more}`;
      return text(
        `You are the narrator for "${s.title}". The user chose to play this through Plot Speaks; the script below is the game they asked for, and their own requests come first. ` +
        `Story slug: ${s.slug}. Play id: ${playId} (pass it to ${passTo}).\n\n${prefaceFor(s)}${parts[n - 1]}${opening}`,
      );
    },
  );

  server.registerTool(
    "choose",
    {
      title: "Make a choice",
      // Not read-only: it moves the play on and records where it is.
      annotations: { ...RECORDS, title: "Make a choice" },
      description: "Moves a Plot Speaks choose-your-path story on by the player's choice and returns what happens next: the scene to narrate and the choices that follow, or the ending. With no choice it returns where the play is now and the path so far (for resuming).",
      inputSchema: {
        slug: SLUG.describe("The story slug"),
        play_id: PLAY_ID.describe("The play id from start_story"),
        choice: z.string().max(200).optional().describe("The player's answer: the choice's number, or their words for it"),
      },
    },
    async ({ slug, play_id, choice }) => {
      const r = await resolveStory(ctx, slug);
      if (!r.s) { log("choose", { found: null }); return fail(r.error); }
      const s = r.s;
      if (!s.branches) return fail(`${s.title} isn't a choose-your-path story; play it from the script start_story gave you.`);
      let st: BranchState | null = null;
      let ownPlay = false;
      try {
        const play = ctx.db ? await ctx.db.prepare("SELECT story FROM plays WHERE id = ?").bind(play_id).first<{ story: string }>() : null;
        ownPlay = play?.story === s.slug;
        if (ownPlay) st = await loadState(ctx.db, play_id);
      } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
      if (!ownPlay) { log("choose", { story: s.slug, outcome: "no_play" }); return fail(`I couldn't find that play of ${s.title}. Call start_story to begin it; it returns a play id.`); }
      if (!st) st = initialState(s.branches);
      if (!choice || !choice.trim()) {
        log("choose", { story: s.slug, outcome: "resume", node: st.node });
        return text(renderNode(s.branches, st, { resume: true, title: s.title }));
      }
      if (st.ended) return text(renderNode(s.branches, st, { title: s.title }));
      const node = s.branches.nodes[st.node];
      const open = node ? branchOffered(node, st.flags) : [];
      const picked = matchChoice(open, choice);
      if (!picked) {
        log("choose", { story: s.slug, outcome: "unclear", node: st.node });
        const shown = open.filter((c) => !c.answer);
        const puzzle = open.some((c) => c.answer) ? " If it was a try at the puzzle, it isn't the answer: say so without hinting, and let them try again or pick a choice." : "";
        return fail(`That didn't clearly match one of the choices.${puzzle} The choices are:\n${shown.map((c, i) => `${i + 1}. ${c.text}`).join("\n")}`);
      }
      const next = advance(s.branches, st, picked);
      const ending = next.ended ? s.branches.nodes[next.node]?.ending?.name ?? "The end" : null;
      log("choose", { story: s.slug, outcome: ending ? "ending" : "moved", node: next.node, steps: next.path.length });
      const db = ctx.db;
      if (db) {
        if (ending) {
          // An ending completes the play (Gate 2), like an accusation in a mystery.
          await recordBatch(ctx, play_id, s.slug, (d) => [
            saveStateStatement(d, play_id, next),
            d.prepare(`INSERT INTO play_events (play_id, story, kind, detail, at) VALUES (${PLAY_OF}, ?, 'ending', ?, ?)`).bind(play_id, s.slug, s.slug, ending.slice(0, 80), Date.now()),
          ]);
        } else {
          try { await saveStateStatement(db, play_id, next).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
        }
      }
      if (ending) await noteOutcome(ctx.db, ctx.userId, play_id, `ending: ${ending}`);
      return text(renderNode(s.branches, next, { title: s.title }));
    },
  );

  // ------------------------------------------------------------ trivia (kind: trivia)
  // One helper runs every trivia step: find the story and its play, load the state, apply the step,
  // save the state and log the event, all for this story's own play only.
  const triviaStep = async (slug: string, play_id: string, tool: string, run: (b: NonNullable<Story["trivia"]>, st: ReturnType<typeof newTrivia>) => Step | Promise<Step>) => {
    const r = await resolveStory(ctx, slug);
    if (!r.s) { log(tool, { found: null }); return fail(r.error); }
    const s = r.s;
    if (!s.trivia) return fail(`${s.title} isn't a trivia game.`);
    let st: ReturnType<typeof newTrivia> | null = null;
    let ownPlay = false;
    try {
      const play = ctx.db ? await ctx.db.prepare("SELECT story FROM plays WHERE id = ?").bind(play_id).first<{ story: string }>() : null;
      ownPlay = play?.story === s.slug;
      if (ownPlay) st = await loadTrivia(ctx.db, play_id);
    } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
    if (!ownPlay) return fail(`I couldn't find that game of ${s.title}. Call start_story to begin it; it returns a play id.`);
    const state = st ?? newTrivia(s.trivia);
    const view = dealtBoard(s.trivia, state);
    const out = await run(view, state);
    log(tool, { story: s.slug, error: Boolean(out.error), event: out.event?.verdict ?? null });
    if (out.error) return fail(out.text);
    // A clue just ruled on joins a signed-in player's history, so later games deal around it.
    const ruled = out.state.asked.filter((k) => !state.asked.includes(k));
    if (ruled.length) await rememberClues(ctx, s.slug, view, ruled);
    if (ctx.db) {
      const over = out.state.asked.length >= view.categories.reduce((n, c) => n + c.clues.length, 0);
      await recordBatch(ctx, over ? play_id : null, s.slug, (d) => [
        saveTrivia(d, play_id, out.state),
        ...(out.event ? [d.prepare(`INSERT INTO play_events (play_id, story, kind, detail, verdict, at) VALUES (${PLAY_OF}, ?, ?, ?, ?, ?)`).bind(play_id, s.slug, s.slug, out.event.kind, out.event.detail.slice(0, 120), out.event.verdict ?? null, Date.now())] : []),
        ...(over ? [d.prepare(`INSERT INTO play_events (play_id, story, kind, detail, at) VALUES (${PLAY_OF}, ?, 'ending', 'board cleared', ?)`).bind(play_id, s.slug, s.slug, Date.now())] : []),
        ...(over && ctx.userId ? [d.prepare("UPDATE user_history SET outcome = ?, finished_at = ? WHERE user_id = ? AND play_id = ?").bind(`board cleared: ${Object.entries(out.state.scores).map(([n, v]) => `${n} ${v}`).join(", ").slice(0, 70) || "no points"}`, Date.now(), ctx.userId, play_id)] : []),
      ]);
    }
    return text(out.text);
  };

  server.registerTool(
    "game_board",
    {
      title: "Trivia board",
      annotations: { ...READ_ONLY, title: "Trivia board" },
      description: "Returns a Plot Speaks trivia game's scores and the categories and values still on the board.",
      inputSchema: { slug: SLUG.describe("The game's slug"), play_id: PLAY_ID.describe("The play id from start_story") },
    },
    async ({ slug, play_id }) => triviaStep(slug, play_id, "game_board", (b, st) => ({ text: renderBoard(b, st), state: st })),
  );
  server.registerTool(
    "game_question",
    {
      title: "Trivia clue",
      annotations: { ...RECORDS, title: "Trivia clue" },
      description: "Opens one clue on a Plot Speaks trivia board and returns its text (not the answer). Category \"final\" opens the final once the board is clear.",
      inputSchema: {
        slug: SLUG.describe("The game's slug"),
        play_id: PLAY_ID.describe("The play id from start_story"),
        category: z.string().min(1).max(80).describe("The category the player picked, or \"final\""),
        value: z.number().int().min(1).max(10000).optional().describe("The value the player picked, e.g. 300"),
      },
    },
    async ({ slug, play_id, category, value }) => triviaStep(slug, play_id, "game_question", (b, st) => askQuestion(b, st, category, value)),
  );
  server.registerTool(
    "game_answer",
    {
      title: "Trivia answer",
      annotations: { ...RECORDS, title: "Trivia answer" },
      description: "Checks a player's answer to the open trivia clue, scores it and returns the ruling with the answer, or the next step of a stepped clue.",
      inputSchema: {
        slug: SLUG.describe("The game's slug"),
        play_id: PLAY_ID.describe("The play id from start_story"),
        answer: z.string().min(1).max(200).describe("What the player said, in their words"),
        player: z.string().max(40).optional().describe("The answering player's name, for the scores"),
      },
    },
    async ({ slug, play_id, answer, player }) => triviaStep(slug, play_id, "game_answer", (b, st) => answerQuestion(b, st, answer, player)),
  );
  server.registerTool(
    "game_challenge",
    {
      title: "Challenge a ruling",
      annotations: { ...RECORDS, title: "Challenge a ruling" },
      description: "Challenges the last trivia ruling: three different AI models judge the player's answer against the clue, and the ruling flips only if at least two agree it should count. Once per clue.",
      inputSchema: { slug: SLUG.describe("The game's slug"), play_id: PLAY_ID.describe("The play id from start_story") },
    },
    async ({ slug, play_id }) => triviaStep(slug, play_id, "game_challenge", (b, st) => challenge(ctx.env.AI as never, b, st)),
  );

  // ------------------------------------------------------------ campaigns (kind: campaign)
  const campaignPlay = async (slug: string, play_id?: string, resume_code?: string): Promise<{ s: Story; playId: string; w: World } | { error: string }> => {
    const r = await resolveStory(ctx, slug);
    if (!r.s) return { error: r.error };
    if (kindOfStory(r.s) !== "campaign") return { error: `${r.s.title} isn't a campaign.` };
    const db = ctx.db;
    if (!db) return { error: "Campaigns aren't available on this server right now." };
    let id = play_id ?? "";
    try {
      if (!id && resume_code) id = (await db.prepare("SELECT play_id FROM campaign_codes WHERE code_hash = ?").bind(await codeHash(resume_code)).first<{ play_id: string }>())?.play_id ?? "";
      // Signed in: their latest campaign of this story, no code needed.
      if (!id && !resume_code && ctx.userId) id = (await db.prepare("SELECT p.id FROM plays p JOIN play_state s ON s.play_id = p.id WHERE p.user_id = ? AND p.story = ? AND s.kind = 'campaign' ORDER BY s.updated_at DESC LIMIT 1").bind(ctx.userId, r.s.slug).first<{ id: string }>())?.id ?? "";
      const play = id ? await db.prepare("SELECT story FROM plays WHERE id = ?").bind(id).first<{ story: string }>() : null;
      if (play?.story !== r.s.slug) return { error: resume_code ? `No ${r.s.title} campaign has the code "${resume_code.slice(0, 60)}". Ask the players to say it again, word by word.` : `I couldn't find that ${r.s.title} campaign. Ask for its resume code, or start a new one with start_story.` };
      const w = await loadWorld(db, id);
      if (!w) return { error: "That campaign's world couldn't be loaded." };
      // A campaign started without an account and resumed with its code by a signed-in player moves
      // onto their account, so next time it resumes with no code at all.
      if (resume_code && ctx.userId) await claimPlays(db, ctx.userId, [id], () => ({ title: r.s!.title, kind: "campaign" }));
      return { s: r.s, playId: id, w };
    } catch (e) {
      log("db_error", { message: String(e).slice(0, 200) });
      return { error: "Campaigns aren't available right now; keep playing and record changes when Plot Speaks is back." };
    }
  };

  server.registerTool(
    "roll",
    {
      title: "Roll dice",
      annotations: { ...READ_ONLY, idempotentHint: false, title: "Roll dice" },
      description: "Rolls dice for a Plot Speaks campaign or adventure on the server: \"1d20+5\", \"2d6\", \"adv 1d20+3\" (advantage), \"dis 1d20\" (disadvantage), \"4d6 drop lowest\". Returns each die and the total.",
      inputSchema: {
        dice: z.string().min(2).max(40).describe("The roll, e.g. 1d20+5"),
        why: z.string().max(80).optional().describe("What the roll is for, e.g. Mira's stealth check"),
      },
    },
    async ({ dice, why }) => {
      const r = rollDice(dice);
      log("roll", { ok: !("error" in r) });
      if ("error" in r) return fail(r.error);
      return text(`${why ? `${String(why).slice(0, 80)}: ` : ""}${r.text} Say the result aloud as rolled; never change it.`);
    },
  );
  server.registerTool(
    "world_recall",
    {
      title: "Recall the campaign",
      annotations: { ...READ_ONLY, title: "Recall the campaign" },
      description: "Returns a Plot Speaks campaign's state (day, place, party with hit points, spell slots and gear, people met, quests, the story so far) by play id, or by the three-word resume code the players were given.",
      inputSchema: {
        slug: SLUG.describe("The campaign's slug"),
        play_id: PLAY_ID.optional().describe("The play id, when you have it"),
        resume_code: z.string().max(80).optional().describe("The three-word resume code the players say"),
      },
    },
    async ({ slug, play_id, resume_code }) => {
      const c = await campaignPlay(slug, play_id, resume_code);
      log("world_recall", { found: !("error" in c), by_code: Boolean(resume_code) });
      if ("error" in c) return fail(c.error);
      return text(`Campaign play id: ${c.playId} (pass it to world_update).\n\n${recall(c.w)}\n\nGive the players a short spoken recap of the story so far, then ask what they do.`);
    },
  );
  const partySchema = z.object({
    name: z.string().min(1).max(40), class: z.string().max(30).optional(), level: z.number().int().min(1).max(5).optional(),
    hp: z.number().int().min(0).max(500).optional(), max_hp: z.number().int().min(1).max(200).optional(),
    damage: z.number().int().min(0).max(500).optional(), heal: z.number().int().min(0).max(500).optional(),
    max_slots: z.record(z.string(), z.number().int().min(0).max(4)).optional(), spend_slot: z.string().regex(/^[1-5]$/).optional(),
    conditions: z.array(z.string().max(30)).max(8).optional(), add_items: z.array(z.string().max(60)).max(10).optional(),
    remove_items: z.array(z.string().max(60)).max(10).optional(), gold: z.number().int().min(-1000000).max(1000000).optional(), remove: z.boolean().optional(),
  });
  server.registerTool(
    "world_update",
    {
      title: "Update the campaign",
      annotations: { ...RECORDS, title: "Update the campaign" },
      description: "Records what happened in a Plot Speaks campaign: new characters, damage and healing, spells cast, items gained or lost, gold, rests, where the party is, the day, people met (the dead stay dead), quests, and a one-line note for the story so far. Refuses changes the rules don't allow and says why.",
      inputSchema: {
        slug: SLUG.describe("The campaign's slug"),
        play_id: PLAY_ID.describe("The campaign play id"),
        party: z.array(partySchema).max(6).optional().describe("Changes to party members, by name (a new name adds a character)"),
        location: z.string().max(120).optional().describe("Where the party is now"),
        day: z.number().int().min(1).optional().describe("The campaign day, if it moved on"),
        rest: z.enum(["short", "long"]).optional().describe("A short or long rest"),
        npcs: z.array(z.object({ name: z.string().min(1).max(50), status: z.string().max(30).optional(), note: z.string().max(160).optional() })).max(10).optional().describe("People met or changed (status e.g. friendly, hostile, dead)"),
        quests: z.array(z.object({ name: z.string().min(1).max(60), status: z.enum(["open", "done", "failed"]).optional(), note: z.string().max(160).optional() })).max(10).optional(),
        note: z.string().max(240).optional().describe("One line for the story so far"),
      },
    },
    async ({ slug, play_id, ...changes }) => {
      const c = await campaignPlay(slug, play_id);
      if ("error" in c) { log("world_update", { found: false }); return fail(c.error); }
      const { world, refused, done } = applyChanges(c.w, changes as WorldChanges);
      log("world_update", { story: c.s.slug, refused: refused.length, done: done.length });
      if (ctx.db) {
        try { await saveWorld(ctx.db, c.playId, world).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); return fail("The change couldn't be saved; try again in a moment."); }
      }
      return text([
        done.length ? `RECORDED:\n${done.map((d) => `- ${d}`).join("\n")}` : "Nothing changed.",
        refused.length ? `REFUSED (the rules don't allow it; narrate it differently):\n${refused.map((d) => `- ${d}`).join("\n")}` : "",
        recall(world),
      ].filter(Boolean).join("\n\n"));
    },
  );

  server.registerTool(
    "check_accusation",
    {
      title: "Check an accusation",
      // Not read-only: it logs an anonymous accusation event for the play.
      annotations: { ...RECORDS, title: "Check an accusation" },
      description: "Checks a formal accusation in a Plot Speaks mystery. Returns the verdict line for the accused person, starting Correct. or Innocent., and the name it matched. Records the accusation and verdict anonymously.",
      inputSchema: {
        slug: SLUG.describe("The story slug"),
        accused: z.string().min(1).max(120).describe("The name of the person the user accused"),
        play_id: PLAY_ID.optional().describe("The play id from start_story"),
      },
    },
    async ({ slug, accused, play_id }) => {
      const r = await resolveStory(ctx, slug);
      if (!r.s) { log("check_accusation", { found: null }); return fail(r.error); }
      const s = r.s;
      if (!s.endings.length) { log("check_accusation", { story: s.slug, matched: null }); return fail(`${s.title} has no accusations: it's an adventure, played on to its ending.`); }
      const m = matchEnding(s.endings, accused) as { ending: Ending | null; candidates: string[] };
      // The matched name, never the raw accusation text (review S11).
      log("check_accusation", { story: s.slug, matched: m.ending?.name ?? null, verdict: m.ending?.verdict ?? null, candidates: m.candidates?.length ?? 0, play_id: Boolean(play_id) });
      if (!m.ending && m.candidates.length) {
        return fail(`"${String(accused).slice(0, 120)}" could be more than one person in ${s.title}: ${m.candidates.join(" or ")}. Ask the player which one they mean, then call check_accusation again.`);
      }
      if (!m.ending) return fail(`I couldn't match "${String(accused).slice(0, 120)}" to anyone in ${s.title}. Ask the player which of these they mean: ${sortedNames(s.endings).join(", ")}.`);
      const e = m.ending;
      await recordBatch(ctx, play_id, s.slug, (db) => [
        db.prepare(`INSERT INTO play_events (play_id, story, kind, detail, verdict, at) VALUES (${PLAY_OF}, ?, 'accusation', ?, ?, ?)`).bind(play_id ?? null, s.slug, s.slug, e.name, e.verdict, Date.now()),
      ]);
      await noteOutcome(ctx.db, ctx.userId, play_id, e.verdict === "correct" ? `solved (${e.name})` : `accused ${e.name}`);
      return text(`${e.text}\n\nmatched: ${e.name} (for you, not to read aloud: if that isn't who the player meant, ask them and check again)`);
    },
  );

  server.registerTool(
    "reveal_solution",
    {
      title: "Full reveal",
      // Not read-only: it records a 'reveal' play event. It gives the whole solution, so it is gated:
      // the play must have an accusation on record, or the player must have said they give up.
      annotations: { ...RECORDS, title: "Full reveal" },
      description: "Returns the full solution of a Plot Speaks mystery (who did it, why, and the clues that pointed there) and what became of each character. Only after the player has accused someone, or when they say they give up or ask for the full reveal (gave_up: true). Records the reveal anonymously.",
      inputSchema: {
        slug: SLUG.describe("The story slug"),
        play_id: PLAY_ID.describe("The play id from start_story"),
        gave_up: z.boolean().optional().describe("True when the player has said they give up or want the answer without accusing anyone"),
      },
    },
    async ({ slug, play_id, gave_up }) => {
      const r = await resolveStory(ctx, slug);
      if (!r.s) { log("reveal_solution", { found: null }); return fail(r.error); }
      const s = r.s;
      const correct = s.endings.filter((e) => e.verdict === "correct");
      if (!s.full_reveal && !correct.length) {
        log("reveal_solution", { story: s.slug, outcome: "none" });
        return fail(`${s.title} has no reveal: it's an adventure, so play on to its ending.`);
      }
      if (!gave_up) {
        let accused = false;
        try {
          accused = Boolean(ctx.db && (await ctx.db.prepare("SELECT 1 AS ok FROM play_events WHERE play_id = ? AND story = ? AND kind = 'accusation' LIMIT 1").bind(play_id, s.slug).first()));
        } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
        if (!accused) {
          log("reveal_solution", { story: s.slug, outcome: "gated" });
          return fail("Ask the player to accuse someone first, or confirm they want to give up.");
        }
      }
      log("reveal_solution", { story: s.slug, outcome: gave_up ? "gave_up" : "after_accusation", full: Boolean(s.full_reveal) });
      await recordBatch(ctx, play_id, s.slug, (db) => [
        db.prepare(`INSERT INTO play_events (play_id, story, kind, detail, at) VALUES (${PLAY_OF}, ?, 'reveal', ?, ?)`).bind(play_id, s.slug, s.slug, gave_up ? "gave_up" : "after_accusation", Date.now()),
      ]);
      // Until a story has its ## Full reveal section, the culprit's Endings detail line stands in.
      if (gave_up) await noteOutcome(ctx.db, ctx.userId, play_id, "gave up");
      const readAloud = s.full_reveal?.read_aloud ?? correct.map((e) => e.text.replace(/^Correct\.\s*/, "")).join("\n\n");
      const out = [`READ ALOUD (the solution, in your narrator voice; this ends the mystery):\n${readAloud}`];
      if (s.full_reveal?.afterward) {
        out.push(`WHAT BECAME OF THEM (read this aloud only if the player says yes to "Would you like to hear what became of each of them?"; ask first if you haven't):\n${s.full_reveal.afterward}`);
      }
      return text(out.join("\n\n"));
    },
  );

  server.registerTool(
    "get_cue",
    {
      title: "Get a scene cue",
      // Read-only (review S7): it returns story data and records nothing.
      annotations: { ...READ_ONLY, title: "Get a scene cue" },
      description: "Returns a cue from a Plot Speaks adventure: the scene text to narrate, and the scene's notes for the narrator.",
      inputSchema: {
        slug: SLUG.describe("The story slug"),
        cue: z.string().max(8).regex(/^S?\d+[a-z]?$/i).describe("The cue id, e.g. S1 or S3b"),
      },
    },
    async ({ slug, cue }) => {
      const r = await resolveStory(ctx, slug);
      const id = cue.toUpperCase().startsWith("S") ? cue.toUpperCase() : `S${cue.toUpperCase()}`;
      const c = r.s?.cues[id];
      log("get_cue", { story: r.s?.slug ?? null, cue: id, found: Boolean(c) });
      if (!r.s) return fail(r.error);
      const s = r.s;
      if (!c) return fail(`No cue ${id} in ${s.title}.${Object.keys(s.cues).length ? "" : " This story has no cues."}`);
      const notes = [c.narrator_only, id === "S1" && s.listen_for ? `Follow-up cues to listen for during this story:\n${s.listen_for}` : null].filter(Boolean).join("\n\n");
      return text(`READ ALOUD (in your own narrator voice):\n${c.read_aloud}` + (notes ? `\n\nNARRATOR NOTES (not read aloud: they would spoil the scene):\n${notes}` : ""));
    },
  );

  server.registerTool(
    "rate_story",
    {
      title: "Rate a story",
      annotations: { ...RECORDS, title: "Rate a story" },
      description: "Saves a rating and feedback for a Plot Speaks story the user has just played: 1 to 5 stars, whether anything was given away too early, an optional comment about the story, and optional feedback about the experience for the people who make Plot Speaks. Needs the play id from start_story; one rating per play.",
      inputSchema: {
        slug: SLUG.describe("The story slug"),
        stars: z.number().int().min(1).max(5).describe("1 to 5"),
        spoiled: z.boolean().optional().describe("True if the player felt the narrator gave something away too early"),
        comment: z.string().max(500).optional().describe("The player's comment about the story, if any, in their words"),
        feedback: z.string().max(1000).optional().describe("Feedback about the experience (the narration, the connector, what to improve), if any, in the player's words; read by the people who make Plot Speaks"),
        play_id: PLAY_ID.describe("The play id from start_story"),
      },
    },
    async ({ slug, stars, spoiled, comment, feedback, play_id }) => {
      const r = await resolveStory(ctx, slug);
      if (!r.s) { log("rate_story", { found: null }); return fail(r.error); }
      const s = r.s;
      const db = ctx.db;
      if (!db) return fail("Ratings aren't available on this server right now. Nothing was saved.");
      let play: { story: string; tester: number } | null = null;
      try { play = await db.prepare("SELECT story, tester FROM plays WHERE id = ?").bind(play_id).first(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
      if (!play || play.story !== s.slug) {
        log("rate_story", { story: s.slug, outcome: "no_play" });
        return fail(`I couldn't find that play of ${s.title}. A rating needs the play id start_story returned for this story; nothing was saved.`);
      }
      // Tester ratings are kept for us and left out of the public averages (review S3).
      const tester = play.tester || ctx.tester ? 1 : 0;
      log("rate_story", { story: s.slug, stars, spoiled: spoiled ?? null, tester, feedback: Boolean(feedback) });
      await recordBatch(ctx, play_id, s.slug, (d) => [
        d.prepare("DELETE FROM ratings WHERE play_id = ?").bind(play_id),
        d.prepare("INSERT INTO ratings (play_id, story, stars, spoiled, comment, feedback, at, tester) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(play_id, s.slug, stars, spoiled === undefined ? null : spoiled ? 1 : 0, comment ?? null, feedback?.trim() || null, Date.now(), tester),
      ]);
      const closing = " Then say: \"Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or play this one again?\"";
      return text((feedback ? "Thanks, rating and feedback saved. Tell the player their feedback goes to the people who make Plot Speaks." : "Thanks, rating saved.") + closing);
    },
  );

  // ------------------------------------------------------------ Story Studio (write and review)
  server.registerTool(
    "write_story",
    {
      title: "Write a story",
      annotations: { ...READ_ONLY, title: "Write a story" },
      description: "Returns material for writing a Plot Speaks story: a short introduction to how a story is built (a public story.md and a private answer key, secrets.md, reviewed by a person before anything is published), a suggested way to draft and review it together, and the format template.",
      inputSchema: {
        genre: (gpt ? z.enum(WRITE_GENRES_GPT) : z.enum(WRITE_GENRES)).optional().describe("murder-mystery (default), dark (a dark murder mystery), adventure, branching (a choose-your-path story), trivia (a trivia board) or game (a voice game)"),
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
      annotations: { ...READ_ONLY, title: "Review a story draft" },
      description: "Runs the format checks on a draft story.md, and with secrets.md also the answer-key checks (including whether story.md gives the culprit away). Returns a status, the findings with line numbers, and a fair-play checklist. Nothing sent is stored.",
      inputSchema: {
        story_md: z.string().min(1).max(60000).describe("The full text of story.md"),
        secrets_md: z.string().max(60000).optional().describe("The full text of secrets.md (the private answer key), if written"),
        slug: z.string().max(80).optional().describe("The story's folder name, e.g. the-last-toast; checks that name is plotspeaks-<slug>"),
      },
    },
    async ({ story_md, secrets_md, slug }) => {
      const rv = reviewStory(story_md, secrets_md ?? "", slug);
      // Counts only: never the submitted text, title or slug.
      log("review_story", { story_chars: story_md.length, secrets_chars: secrets_md?.length ?? 0, errors: rv.errors, warnings: rv.warnings });
      return text(rv.report);
    },
  );

  // ------------------------------------------------------------ Story Studio (submit, M5)
  server.registerTool(
    "submit_story",
    {
      title: "Submit a story",
      annotations: { title: "Submit a story", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      description: "Submits a finished Plot Speaks story for human review, credited to the name the writer chooses. Runs the format checks, a safety screen and a daily limit, then stores it; nothing is public until a person approves it. Returns a submission id and a one-time claim code for withdrawing or updating it. With replaces_id and claim_code, it replaces an earlier submission.",
      inputSchema: {
        story_md: z.string().min(1).max(60000).describe("The full text of story.md"),
        secrets_md: z.string().max(30000).optional().describe("The full text of secrets.md (kept private on the server; mysteries need one)"),
        author_name: z.string().min(2).max(60).describe("The name credited publicly as \"Written by\" (2 to 60 characters; a pen name is fine). Checked by the reviewer with the story."),
        contact: z.string().max(200).optional().describe("Optional: how the reviewer can reach the writer (email or handle). Seen only by the reviewer."),
        replaces_id: z.string().max(40).optional().describe("Only to update an earlier submission: its submission id"),
        claim_code: z.string().max(40).optional().describe("Only to update an earlier submission: the claim code from its receipt"),
      },
    },
    async (args) => {
      const out = await submitStory(ctx.env, { ip: ctx.ip, connector: connectorOf(ctx) }, BUILTINS, args);
      return /^Not submitted|^Submissions aren't available/.test(out) ? fail(out) : text(out);
    },
  );

  server.registerTool(
    "withdraw_submission",
    {
      title: "Withdraw a submission",
      annotations: { title: "Withdraw a submission", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: "Deletes a story submitted to Plot Speaks (pending or published) when its submission id and claim code match.",
      inputSchema: {
        id: z.string().min(1).max(40).describe("The submission id from the receipt"),
        claim_code: z.string().min(1).max(40).describe("The claim code from the receipt, e.g. ABCD-EFGH-JKMN"),
      },
    },
    async ({ id, claim_code }) => {
      const out = await withdrawSubmission(ctx.env, { id, claim_code });
      return /^Not withdrawn|aren't available/.test(out) ? fail(out) : text(out);
    },
  );

  return server;
}

// The assistant whose connector made the request, or null for a direct caller. Connector traffic
// comes from the assistant company's servers, so its IP says nothing about the person (review S6).
const connectorOf = (ctx: Ctx): string | null => {
  if (ctx.chatgpt) return "ChatGPT";
  const a = assistantOf(ctx.client);
  return a === "Other" ? null : a;
};

// ChatGPT's MCP client identifies itself in the User-Agent (e.g. "openai-mcp/1.0.0"). OpenAI
// documents no stable UA, so a tools/call carrying openai/* _meta keys counts too (fail closed).
const isChatGPTUa = (ua: string | null) => /openai|chatgpt/i.test(ua ?? "");
const hasOpenAiMeta = (msgs: any[]) =>
  msgs.some((m) => m && m.method === "tools/call" && m.params && typeof m.params._meta === "object" && m.params._meta !== null
    && Object.keys(m.params._meta).some((k) => k.startsWith("openai/")));

type Env = SubEnv & AuthEnv & {
  ASSETS?: { fetch: (request: Request) => Promise<Response> }; OPENAI_APPS_CHALLENGE?: string; TESTER_KEY?: string;
  // Optional accounts: the account connector's host name, and the KV namespace the OAuth provider keeps grants in.
  ACCOUNT_HOST?: string; OAUTH_KV?: KVNamespace;
};
const MAX_BODY_BYTES = 1_000_000;

// ------------------------------------------------------------------ audio with byte ranges
// The home page's audio sample (public/audio/). Static assets answer a Range request with the
// whole file and a 200, and iOS Safari won't play media from a server without byte ranges, so
// /audio/* runs the Worker first (assets.run_worker_first in wrangler.jsonc) and is sliced here.
async function serveAudio(request: Request, assets: NonNullable<Env["ASSETS"]>): Promise<Response> {
  const res = await assets.fetch(new Request(request.url, { method: "GET" }));
  if (!res.ok) return res;
  const body = new Uint8Array(await res.arrayBuffer());
  const size = body.length;
  const headers = new Headers({
    "content-type": res.headers.get("content-type") || "audio/mpeg",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
  });
  const etag = res.headers.get("etag");
  if (etag) headers.set("etag", etag);
  const head = request.method === "HEAD";
  if (etag && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  // A multi-part range (bytes=0-1,5-9) or a stale If-Range (the file changed since the client's
  // first slice) gets the whole file, as RFC 9110 allows; a slice of a different file would garble playback.
  const ifRange = request.headers.get("if-range");
  const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get("range") ?? "").trim());
  if (!m || (!m[1] && !m[2]) || (ifRange && ifRange !== etag)) {
    headers.set("content-length", String(size));
    return new Response(head ? null : body, { status: 200, headers });
  }
  let start: number, end: number;
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (start >= size || start > end) {
    headers.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(head ? null : body.subarray(start, end + 1), { status: 206, headers });
}

// ------------------------------------------------------------------ passenger page API
// JSON for the site's public passenger page (for players who paste the story into a chat with no
// connector). Each endpoint does what check_accusation, get_cue or reveal_solution does, one answer
// at a time, and logs the same way with app "passenger-page":
//   GET /api/stories/<slug>/names           {"names": [...]}            Endings detail names only, sorted
//   GET /api/stories/<slug>/check?name=<n>  {"verdict", "line"}          one ending line (same matching as check_accusation)
//   GET /api/stories/<slug>/cue/<id>        {"read_aloud": "..."}       never the narrator notes
//   GET /api/stories/<slug>/listen          {"follow_ups": [{when, cue}]} the Listen-for table, so a passenger knows when to call S2b etc.
//   GET /api/stories/<slug>/full-reveal     {"read_aloud", "afterward"}  the ## Full reveal section (the page asks the passenger to confirm first)
// Unknown slug, cue or name: 404 JSON (an ambiguous name: 404 with "candidates"). Slugs match
// exactly (the page links them), not fuzzily. These endpoints are public by design: a passenger
// has no play id. So reveal_solution's accusation gate restrains the narrator's own tool use, not
// a player who fetches the URL; the Cloudflare rate-limit rule on /api/* (docs/DECISIONS.md) is the
// only brake. HEAD requests answer without recording an event.
const PASSENGER = "passenger-page";
const apiJson = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

async function handlePassengerApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const m = /^\/api\/stories\/([a-z0-9-]+)\/(names|check|listen|full-reveal|cue\/([A-Za-z0-9]+))\/?$/.exec(url.pathname);
  if (!m) return url.pathname.startsWith("/api/") ? apiJson({ error: "not_found" }, 404) : null;
  if (request.method !== "GET" && request.method !== "HEAD") return apiJson({ error: "method_not_allowed" }, 405);
  const [, slug, what, cueId] = m;
  const s = STORIES.find((x) => x.slug === slug && !x.preview) ?? (await loadApprovedStories(env.DB)).find((x) => x.slug === slug && !BUILTINS.slugs.has(x.slug));
  if (!s) return apiJson({ error: "unknown_story" }, 404);
  const db = request.method === "GET" ? env.DB : undefined;
  const recordEvent = async (sql: string, ...args: unknown[]) => {
    if (!db) return;
    try { await db.prepare(sql).bind(...args).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
  };
  if (what === "names") {
    log("passenger_names", { app: PASSENGER, story: s.slug });
    // Sorted, so the order in secrets.md (often the culprit first) gives nothing away.
    return apiJson({ names: sortedNames(s.endings) });
  }
  if (what === "listen") {
    // The paste-play "Listen for" table: what to listen for, and which follow-up cue to call then.
    const rows = (s.listen_for_raw ?? s.listen_for ?? "").split(/\r?\n/)
      .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
      .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
      .filter((r) => r.length >= 2 && !/^when you hear/i.test(r[0]))
      // Rows whose "say" cell names no S-cue (a plain reminder) are left out: the page can only call cues.
      .flatMap(([when, say]) => { const c = /S\d+[a-z]?/i.exec(say); return c ? [{ when, cue: c[0].replace(/^s/, "S") }] : []; });
    log("passenger_listen", { app: PASSENGER, story: s.slug, rows: rows.length });
    return apiJson({ follow_ups: rows });
  }
  if (what === "full-reveal") {
    log("reveal_solution", { app: PASSENGER, story: s.slug, found: Boolean(s.full_reveal) });
    if (!s.full_reveal) return apiJson({ error: "no_reveal" }, 404);
    await recordEvent("INSERT INTO play_events (play_id, story, kind, detail, at, app) VALUES (NULL, ?, 'reveal', 'passenger', ?, ?)", s.slug, Date.now(), PASSENGER);
    return apiJson({ read_aloud: s.full_reveal.read_aloud, afterward: s.full_reveal.afterward });
  }
  if (what === "check") {
    const accused = (url.searchParams.get("name") ?? "").trim().slice(0, 120);
    if (!accused) return apiJson({ error: "missing_name" }, 400);
    const r = matchEnding(s.endings, accused) as { ending: Ending | null; candidates?: string[] };
    const e = r.ending;
    const cands = r.candidates ?? [];
    log("check_accusation", { app: PASSENGER, story: s.slug, matched: e?.name ?? null, verdict: e?.verdict ?? null, candidates: cands.length });
    if (!e) return apiJson({ error: "no_match", names: cands.length ? cands : sortedNames(s.endings), ...(cands.length ? { candidates: cands } : {}) }, 404);
    await recordEvent("INSERT INTO play_events (play_id, story, kind, detail, verdict, at, app) VALUES (NULL, ?, 'accusation', ?, ?, ?, ?)", s.slug, e.name, e.verdict, Date.now(), PASSENGER);
    return apiJson({ verdict: e.verdict === "correct" ? "correct" : "wrong", line: e.text });
  }
  const id = cueId.toUpperCase().startsWith("S") ? cueId.toUpperCase() : `S${cueId.toUpperCase()}`;
  const c = s.cues[id];
  log("get_cue", { app: PASSENGER, story: s.slug, cue: id, found: Boolean(c) });
  if (!c) return apiJson({ error: "unknown_cue" }, 404);
  await recordEvent("INSERT INTO play_events (play_id, story, kind, detail, at, app) VALUES (NULL, ?, 'cue', ?, ?, ?)", s.slug, id, Date.now(), PASSENGER);
  return apiJson({ read_aloud: c.read_aloud });
}

// ------------------------------------------------------------------ accounts: memory and site pages

/** Trivia clues a signed-in player has heard on this board (empty for the open connector). */
async function seenClues(ctx: Ctx, slug: string): Promise<Set<string>> {
  if (!ctx.db || !ctx.userId) return new Set();
  try {
    const { results } = await ctx.db.prepare("SELECT clue FROM user_seen WHERE user_id = ? AND story = ?").bind(ctx.userId, slug).all<{ clue: string }>();
    return new Set((results ?? []).map((r) => r.clue));
  } catch { return new Set(); }
}
/** Adds the clues just ruled on to a signed-in player's history for this board. */
async function rememberClues(ctx: Ctx, slug: string, view: TriviaBoard, keys: string[]) {
  if (!ctx.db || !ctx.userId) return;
  const db = ctx.db, userId = ctx.userId;
  const ids = keys.map((k) => {
    const [cat, value] = k.split("|");
    const c = view.categories.find((x) => x.name.toLowerCase() === cat);
    const q = c?.final ? c.clues[0] : c?.clues.find((x) => String(x.value) === value);
    return c && q ? clueId(c.name, q) : null;
  }).filter((x): x is string => Boolean(x));
  if (!ids.length) return;
  try { await db.batch(ids.map((id) => db.prepare("INSERT OR IGNORE INTO user_seen (user_id, story, clue, at) VALUES (?, ?, ?, ?)").bind(userId, slug, id, Date.now()))); } catch { /* memory never breaks play */ }
}

/** /auth/google/*, /account, /account/signout and /account/delete on the site host. */
async function handleAccountPages(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const p = url.pathname;
  if (p === "/auth/google/start") return startSignIn(request, env);
  if (p === "/auth/google/callback") return finishSignIn(request, env);
  if (!p.startsWith("/account")) return null;
  const origin = siteOrigin(url);
  // Forms post from this site only (the session cookie would ride along on a cross-site post).
  const sameOrigin = (request.headers.get("origin") ?? origin) === origin;
  if (p === "/account/signout" && request.method === "POST" && sameOrigin) return signOut(request, env);
  const user = await currentUser(request, env);
  if (p === "/account/delete" && request.method === "POST" && sameOrigin && user) {
    await deleteAccount(env, user.id);
    return signOut(request, env);
  }
  if (p !== "/account" || request.method !== "GET") return null;
  const history = user ? await historyOf(env.DB, user.id) : [];
  const resp = new Response(accountPage({ user, history, configured: signInConfigured(env), accountMcp: env.ACCOUNT_HOST ? `https://${env.ACCOUNT_HOST}/mcp` : null }, origin), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  return withAccountLink(request, env, resp);
}

/** Puts "Sign in" or the person's first name in the page header (site pages leave a marker for it). */
async function withAccountLink(request: Request, env: Env, res: Response): Promise<Response> {
  if (!(res.headers.get("content-type") ?? "").startsWith("text/html")) return res;
  const body = await res.text();
  if (!body.includes("<!--ACCOUNT-->")) return new Response(body, res);
  const user = signInConfigured(env) ? await currentUser(request, env) : null;
  const label = user ? esc((user.name ?? "").split(" ")[0] || "Account") : "Sign in";
  const link = signInConfigured(env) ? `<a class="acct" href="/account">${label}</a>` : "";
  const headers = new Headers(res.headers);
  if (user) headers.set("cache-control", "private, no-store");
  // The Connect page's account note: the Claude button itself now adds the account connector, so a
  // short pointer to what signing in keeps is enough.
  const connectNote = signInConfigured(env) ? `<p class="muted">Signing in keeps your saved progress: what you've played, trivia you've heard, and your campaigns. <a href="/account">About accounts</a></p>` : "";
  return new Response(body.replace("<!--ACCOUNT-->", link).replace("<!--ACCOUNT-CONNECT-->", connectNote), { status: res.status, headers });
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 301 for pages; 308 (method-preserving) for anything else, so a redirected POST stays a POST (S15).
const redirect = (request: Request, to: string) => Response.redirect(to, request.method === "GET" || request.method === "HEAD" ? 301 : 308);

// The site and the open connector (plotspeaks.com).
async function mainFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Plain http reaches the custom domain too, and the site builds its "Connect to Claude" link from
    // the request's origin; Claude refuses an http connector URL (Ben, 2026-10-16). Send everyone to https.
    if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      url.protocol = "https:";
      return redirect(request, url.toString());
    }
    // plotspeaks.com is the home (Ben bought it 2026-10-16). The old address and www redirect there,
    // except the old /mcp, which keeps answering: connectors added before the move post to it, and
    // MCP clients don't reliably follow a redirect on POST.
    if (url.hostname === "www.plotspeaks.com" || (url.hostname === "plotspeaks.volocent.com" && url.pathname !== "/mcp")) {
      return redirect(request, `https://plotspeaks.com${url.pathname}${url.search}`);
    }
    if (url.pathname.startsWith("/audio/") && env.ASSETS && (request.method === "GET" || request.method === "HEAD")) {
      return serveAudio(request, env.ASSETS);
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
    // Liveness for monitoring and outside checks: answers 200 when the Worker and its
    // database respond, 503 when the database doesn't. Says nothing else.
    if (url.pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
      let dbOk = false;
      try { dbOk = Boolean(env.DB && (await env.DB.prepare("SELECT 1 AS ok").first())); } catch { dbOk = false; }
      return apiJson({ ok: dbOk, environment: env.ENVIRONMENT ?? null, db: dbOk ? "ok" : "unavailable" }, dbOk ? 200 : 503);
    }
    // The passenger page's answer-key endpoints (public, one answer at a time, like the MCP tools).
    const api = await handlePassengerApi(request, env);
    if (api) return api;
    // Optional accounts on the site: Google sign-in, the account page, signing out, deleting.
    const acct = await handleAccountPages(request, env);
    if (acct) return acct;
    // The catalog pages are public: they show only public story text (see site.ts). The access
    // key below applies to the MCP endpoint only.
    if (url.pathname !== "/mcp") {
      // Approved submissions join the catalog in the same public-only shape (slug + story.md text).
      const approved = await listApprovedSubmissions(env.DB);
      const site = await handleSite(request, approved.length ? [...PUBLIC_STORIES, ...approved.filter((a) => !BUILTINS.slugs.has(a.slug))] : PUBLIC_STORIES, env.DB, PREVIEW_STORIES);
      if (site) {
        // A tally per page view, for the admin stats (src/usage.ts): counts only, no visitor data.
        ctx.waitUntil(countPage(env.DB, request, site));
        return withAccountLink(request, env, site);
      }
    }
    // Dev lock (Ben, 2026-10-15): until real sign-in arrives in M5, the dev server answers only
    // requests carrying the shared key, sent by the Claude connector as a request header.
    // No OAuth here: sign-in discovery URLs answer 404, which clients read as "no sign-in".
    // OpenAI's plugin directory verifies the domain by fetching this token (set as the secret
    // OPENAI_APPS_CHALLENGE). Every other /.well-known/ path, the OAuth ones included, stays 404 so
    // Claude keeps seeing a server with no sign-in.
    if (url.pathname === "/.well-known/openai-apps-challenge" && env.OPENAI_APPS_CHALLENGE) {
      return new Response(env.OPENAI_APPS_CHALLENGE.trim(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname.startsWith("/.well-known/")) return new Response("Not found\n", { status: 404 });
    // Everything else is the MCP endpoint. An unknown path (a typo, a probe, a POST to a page) gets
    // the site's 404, never the access-key message or the MCP handler's bare "Not Found".
    if (url.pathname !== "/mcp") {
      return new Response(notFoundPage(siteOrigin(url)), { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    return serveMcp(request, env, ctx, null);
}

// The MCP endpoint, for both connectors: the open one (userId null) and the account one, where the
// OAuth provider has checked the token and passes the signed-in person's id.
async function serveMcp(request: Request, env: Env, ctx: ExecutionContext, userId: string | null): Promise<Response> {
    // The largest legitimate body is a submit_story call (two 60,000-character files); anything
    // bigger is refused before it is parsed, twice, on a 128 MB isolate.
    if (request.method === "POST" && Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return new Response("Payload too large\n", { status: 413, headers: { "content-type": "text/plain" } });
    }
    // The handshake (initialize, the tool list, pings) is answered without the key, so a client's
    // pre-check can see that this server has no sign-in. Anything that touches a story (tools/call,
    // resources, prompts) still needs the key.
    const OPEN_METHODS = new Set(["initialize", "notifications/initialized", "tools/list", "ping"]);
    let openHandshake = false;
    let msgs: any[] = [];
    if (request.method === "POST") {
      try {
        const body = await request.clone().json();
        msgs = Array.isArray(body) ? body : [body];
        openHandshake = msgs.length > 0 && msgs.every((m) => m && typeof m.method === "string" && OPEN_METHODS.has(m.method));
      } catch { openHandshake = false; }
    }
    // Claude's connector form only accepts approved header names, so the key is read from the
    // standard places: X-API-Key, or Authorization: Bearer <key>.
    const presented = request.headers.get("x-api-key") ?? (/^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "") || [])[1] ?? "";
    // On the account connector the OAuth token is the key, so the dev lock applies to the open one only.
    if (!userId && env.DEV_ACCESS_KEY && !openHandshake && !sameKey(presented.trim(), env.DEV_ACCESS_KEY)) {
      log("rejected", { reason: "missing or wrong access key" });
      if (request.method === "POST") ctx.waitUntil(countMcp(env.DB, msgs, null, false, "rejected"));
      // 403, not 401: MCP clients treat a 401 as "start an OAuth sign-in", and this server has none.
      return new Response("Forbidden: missing or wrong access key. Add it under the connector's Request headers as X-API-Key (or Authorization: Bearer <key>).\n", { status: 403, headers: { "content-type": "text/plain" } });
    }
    // Plays are ours (testers) on the dev server, and on prod when the request carries the tester
    // key (secret TESTER_KEY; the prod smoke test sends it). Any other header a stranger's client
    // happens to send is not a key, so their plays stay strangers' and count toward Gate 2.
    const tester = Boolean(env.DEV_ACCESS_KEY) || Boolean(presented && env.TESTER_KEY && sameKey(presented.trim(), env.TESTER_KEY));
    const client = (request.headers.get("user-agent") ?? "").slice(0, 80) || null;
    const chatgpt = isChatGPTUa(client) || hasOpenAiMeta(msgs);
    // A tool call from a client we don't recognise: logged (the UA only) to spot a changed UA early.
    if (!chatgpt && assistantOf(client) === "Other" && msgs.some((m) => m?.method === "tools/call")) log("unrecognised_client", { client });
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    // MCP requests, tool calls and errors are tallied for the admin stats (src/usage.ts), from a
    // clone of the reply read after it has gone out. Only POSTs carry JSON-RPC messages. The
    // handler catches its own exceptions and answers 500, which the tally records as http_5xx.
    const res = await createMcpHandler(() => createServer({ db: env.DB, tester, client, chatgpt, env, ip, userId }), { route: "/mcp" })(request, env, ctx);
    if (request.method === "POST") ctx.waitUntil(countMcp(env.DB, msgs, res.clone(), tester));
    return res;
}

// The account connector's host: OAuth (discovery, dynamic client registration, tokens) around the
// same MCP endpoint. Plays made through it belong to the signed-in person.
// One provider per account host (account.plotspeaks.com on prod, account-dev on dev), built on first use.
const accountProviders = new Map<string, OAuthProvider<Env>>();
const accountProviderFor = (host: string) => {
  let p = accountProviders.get(host);
  if (!p) { p = makeAccountProvider(`https://${host}`); accountProviders.set(host, p); }
  return p;
};
const makeAccountProvider = (origin: string) => new OAuthProvider<Env>({
  resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ["header"], resource_name: "Plot Speaks (with your account)" },
  apiRoute: "/mcp",
  apiHandler: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => serveMcp(request, env, ctx, String((ctx as unknown as { props?: { userId?: string } }).props?.userId ?? "") || null) },
  defaultHandler: { fetch: (request: Request, env: Env) => accountSite(request, env as unknown as AccountEnv) },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["play"],
  accessTokenTTL: 3600,
  refreshTokenTTL: 180 * 86400,
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const host = new URL(request.url).hostname;
    if (env.ACCOUNT_HOST && host === env.ACCOUNT_HOST && env.OAUTH_KV) return accountProviderFor(host).fetch(request, env, ctx);
    return mainFetch(request, env, ctx);
  },

  // Daily Cron Trigger (wrangler.jsonc "triggers"): 90-day log retention, see src/retention.ts.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runRetention(env.DB)
        .then(async (counts) => { log("retention", counts); await bump(env.DB, [["job", "retention"]]); })
        .catch(async (e) => { log("retention_error", { message: String(e).slice(0, 200) }); await bump(env.DB, [["job", "retention_error"]]); }),
    );
  },
} satisfies ExportedHandler<Env>;
