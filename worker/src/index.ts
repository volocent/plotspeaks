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
import news from "./generated/news.json";
import { handleSite, notFoundPage, siteOrigin, accountPage, publicProfilePage, type PublicStory } from "./site";
import { LENGTHS, WRITE_GENRES, writeStory, reviewStory, DENYLIST } from "./studio";
import { submitStory, withdrawSubmission, hashIp, loadApprovedStories, handleAdmin, serveSubmissionCover, listApprovedSubmissions, sameKey, type SubEnv, type Builtins, type PlayStory, type Ending } from "./submissions";
import { runRetention } from "./retention";
import { alertOnce, routeOf } from "./alert";
import { runGithubWatch } from "./github";
import { profileOf, checkHandle, saveProfile, publicProfile, profileLine } from "./profile";
import { countPage, countMcp, bump } from "./usage";
import { assistantOf } from "./stats";
import { matchStory, matchEnding, sortedNames } from "../../tools/worker-data/match.mjs";
import { initialState, renderNode, matchChoice, advance, rewind, loadState, saveStateStatement, offered as branchOffered, type BranchState, pathSummary, followChoice } from "./branching";
import { resolveTeam, teamBySlug, teamBoard, teamIntro, rosterCategory, rivalryBoard, type Team, teamLine, rosterText, LEAGUES_COVERED, TEAM_TRIVIA } from "./teams";
import { newTrivia, dealtBoard, clueId, renderBoard, watchView, timelineView, type WatchEvent, RATE_ASK, askQuestion, answerQuestion, challenge, loadTrivia, saveTrivia, sizeGame, seeded, todayUtc, type Step, type TriviaBoard } from "./games";

// The daily board (plan 2026-10-19, item 4): one of the general boards, by the day of the year, dealt
// from the same seed for everyone, so the whole car and the next car get the same clues.
const DAILY_WORDS = /^(the )?(daily|today'?s?( board| trivia)?|daily board|daily trivia|board of the day)$/i;
const DAILY_BOARDS = ["trivia-general", "trivia-geography", "trivia-history", "trivia-movies", "trivia-science", "trivia-sports"];
const dailySlug = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  const n = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000);
  return DAILY_BOARDS[n % DAILY_BOARDS.length];
};
import { newWorld, applyChanges, recall, roll as rollDice, newCode, newShortCode, normCode, codeHash, loadWorld, saveWorld, type World, type WorldChanges } from "./world";
import OAuthProvider, { getOAuthApi, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { accountSite, type AccountEnv } from "./account";
import { currentUser, userById, startSignIn, finishSignIn, signOut, deleteAccount, signInConfigured, noteStart, noteOutcome, historyOf, playedSlugs, claimPlays, type AuthEnv } from "./auth";

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
  // Julia's trivia feedback (2026-10-19): the assistant kept saying "let me check on that" before every
  // tool call, and waited for a full sentence after a plain "yes". Both cost her turns and credits.
  "Play smoothly: don't announce tool calls (no \"let me check\" or \"one moment\"); just call the tool and speak the result. A short reply such as \"yes\", \"continue\", \"next\" or \"go on\" is a complete answer: act on it at once and never ask the user to say it in a full sentence. Keep turns short; a quicker, lighter assistant model is fine for these games.",
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
  "When a story or game ends (a correct accusation, the full reveal, a victory or defeat, a choose-your-path ending, the last trivia question, a game's last round, or a campaign session the players stop), ask once: \"Would you like to leave feedback? How many stars out of five would you give the story, did I give anything away too early, and is there anything you'd tell the people who make Plot Speaks?\" Then call rate_story with the stars, the spoiled answer, any comment about the story and any feedback about the experience, with the play id. If the player doesn't want to, drop it. (Wind-downs are the one exception: they end quietly, with no questions.) Either way, end with: \"Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or play this one again?\" Main menu is open_plot_speaks with skip_intro: true; again is start_story for the same story (a new play).",
].join("\n");

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
// Not-found and invalid results are marked as errors (review S16), with the actionable text kept.
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

// Kinds (docs/PLAN-INTERACTIVE-2026-10-16.md section 2): what the player does, the top level of the
// catalogue, the welcome menu and the site's shelves. Inside the mystery kind, the older categories
// (classic, dark, family) still filter list_stories. kind and audience are read at build time.
const KIND_ORDER = ["mystery", "adventure", "branching", "trivia", "game", "campaign"] as const;
type KindId = (typeof KIND_ORDER)[number];
const KIND_NAMES: Record<KindId, string> = { mystery: "Mysteries", adventure: "Adventures", branching: "Choose your path", trivia: "Trivia", game: "Games", campaign: "Open worlds and campaigns" };
const kindOfStory = (s: Story): KindId => ((KIND_ORDER as readonly string[]).includes(s.kind) ? s.kind as KindId : "mystery");
const isFamilyStory = (s: Story) => s.audience === "family" || s.genre === "kids";
type CategoryId = "mystery" | "dark" | "kids" | "adventure";
// metadata.tone is read once, at build time (build.mjs) or when an approved submission is loaded.
function categoryOf(s: Story): CategoryId | null {
  if (kindOfStory(s) === "mystery") return isFamilyStory(s) ? "kids" : s.tone === "dark" ? "dark" : "mystery";
  if (kindOfStory(s) === "adventure") return "adventure";
  return null;
}
// pick_for_me (plan 2026-10-19, item 14): one suggestion from mood words, time and company. Each mood
// word family adds to the stories it fits; a clash (too long, wrong player count, not for children)
// removes or sinks a story; a signed-in player's played stories sink. Ties break at random.
const MOODS: { re: RegExp; fits: (s: Story) => boolean; w: number }[] = [
  { re: /\b(light|fun|silly|easy|chill|quick|laugh|funny)\b/, fits: (s) => ["trivia", "game"].includes(kindOfStory(s)) || isFamilyStory(s), w: 3 },
  { re: /\b(spooky|scary|dark|creepy|horror|haunted|ghost|halloween)\b/, fits: (s) => categoryOf(s) === "dark" || /horror/.test(s.genre) || /halloween|haunt|ghost|seance|séance/i.test(`${s.slug} ${s.title}`), w: 4 },
  { re: /\b(mystery|mysteries|whodunit|detective|murder|clue|solve)\b/, fits: (s) => kindOfStory(s) === "mystery", w: 4 },
  { re: /\b(adventure|fantasy|dragon|quest|hero|epic)\b/, fits: (s) => ["adventure", "branching", "campaign"].includes(kindOfStory(s)), w: 3 },
  { re: /\b(long|ongoing|open|world|campaign|sandbox)\b/, fits: (s) => kindOfStory(s) === "campaign", w: 3 },
  { re: /\b(trivia|quiz|brainy|smart|facts|questions)\b/, fits: (s) => kindOfStory(s) === "trivia", w: 4 },
  { re: /\b(sleep|sleepy|bedtime|calm|relax|wind down|quiet)\b/, fits: (s) => /^(bedtime|winddown)-/.test(s.slug), w: 5 },
  { re: /\b(choose|choice|choices|path)\b/, fits: (s) => kindOfStory(s) === "branching", w: 3 },
  { re: /\b(space|sci ?fi|future|mars|planet|station)\b/, fits: (s) => /space|station|orbit|mars|ceres|hellas|sol-|long-wake|haul/i.test(`${s.slug} ${s.title}`), w: 3 },
  { re: /\b(sport|sports|team|baseball|football|hockey|basketball|soccer)\b/, fits: (s) => /sport|team/.test(s.slug), w: 4 },
];
const playerRange = (p: string) => { const m = /(\d+)\s*(?:-|to|–)\s*(\d+)/.exec(p) ?? /(\d+)/.exec(p); return m ? [Number(m[1]), Number(m[2] ?? m[1])] : [1, 8]; };
const pitchOf = (s: Story) => (/^\s*pitch:\s*"?(.+?)"?\s*$/m.exec(s.story)?.[1] ?? "").slice(0, 300);
function pickStories(all: Story[], o: { mood?: string; minutes?: number; players?: number; kids?: boolean; played?: Set<string> }, rand = Math.random): Story[] {
  const mood = (o.mood ?? "").toLowerCase();
  const words = mood.split(/[^a-z]+/).filter((w) => w.length > 3);
  return all.map((s) => {
    let score = rand();
    const [lo, hi] = playerRange(s.players);
    if (o.players && (o.players < lo || o.players > hi)) return { s, score: -99 };
    if (o.kids && !isFamilyStory(s) && (categoryOf(s) === "dark" || /PG-13|\bR\b/.test(/rating:\s*(\S+)/.exec(s.story)?.[1] ?? ""))) return { s, score: -99 };
    if (o.kids && isFamilyStory(s)) score += 4;
    const resizable = kindOfStory(s) === "trivia"; // a trivia game is sized to the drive
    if (o.minutes && s.duration_minutes && !resizable) score += s.duration_minutes <= o.minutes ? 3 : s.duration_minutes > o.minutes * 1.3 ? -6 : -1;
    for (const m of MOODS) if (m.re.test(mood) && m.fits(s)) score += m.w;
    const hay = `${s.title} ${s.genre} ${pitchOf(s)}`.toLowerCase();
    if (words.some((w) => hay.includes(w))) score += 2;
    if (o.played?.has(s.slug)) score -= 6;
    return { s, score };
  }).filter((x) => x.score > -50).sort((a, b) => b.score - a.score).map((x) => x.s);
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
// metadata.style gamebook: a classic "you are the hero" choose-your-path story, on the site's
// "Your-choice adventures" shelf. An open world is a campaign without D&D rules.
const frontMatter = (s: Story) => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(s.story) || [, ""])[1];
const isGamebook = (s: Story) => kindOfStory(s) === "branching" && /^\s*style:\s*gamebook\b/m.test(frontMatter(s));
const isWinddown = (s: Story) => kindOfStory(s) === "game" && /^\s*style:\s*winddown\b/m.test(frontMatter(s));
const isOpenWorld = (s: Story) => kindOfStory(s) === "campaign" && /^\s*rules_system:\s*none\b/m.test(frontMatter(s));
const listLine = (s: Story) =>
  `${s.title} (slug: ${s.slug}; ${KIND_NAMES[kindOfStory(s)].toLowerCase()}${isGamebook(s) ? ", a your-choice adventure" : ""}${isOpenWorld(s) ? ", an open world with no set ending" : ""}${isWinddown(s) ? ", a calm wind-down (not for the driver)" : ""}${categoryOf(s) === "dark" ? ", dark" : ""}${isFamilyStory(s) ? ", for families" : ""}; ${s.players} players; about ${s.duration_minutes} minutes${s.testing ? "; new, being tested" : ""}${s.season ? `; seasonal, until ${seasonEnd(s)}` : ""}${s.release ? `; ${seasonLine(s)}` : ""})`;

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
  const daily = all.some((s) => s.trivia) ? "- Today's board: one trivia board a day, the same clues for everyone, scores compared at the end (start_story with slug \"daily\")" : null;
  return [daily, ...KIND_ORDER.map((k) => {
    // Family titles go last, so the examples read aloud are the general ones.
    const inK = all.filter((s) => kindOfStory(s) === k).sort((a, b) => Number(isFamilyStory(a)) - Number(isFamilyStory(b)));
    if (!inK.length) return null;
    const titles = inK.map((s) => s.title);
    const more = titles.length > 3 ? `, and ${titles.length - 3} more` : "";
    const notes = [inK.some(isGamebook) ? "including your-choice adventures, where you're the hero" : "", inK.some(isOpenWorld) ? "including open worlds with no set ending" : "", inK.some(isWinddown) ? "including calm wind-downs for the end of the day" : "", inK.some((s) => categoryOf(s) === "dark") ? "some dark" : "", inK.some(isFamilyStory) ? "some for families" : ""].filter(Boolean);
    return `- ${KIND_NAMES[k]}${notes.length ? ` (${notes.join(", ")})` : ""}: ${titles.slice(0, 3).join(", ")}${more}`;
  })].filter(Boolean).join("\n");
}

// A short preface for the served script. The script itself is the connector version, built at
// build time (tools/worker-data/connector.mjs), so nothing here depends on rewriting it.
const prefaceFor = (s: Story) =>
  "## Playing through the Plot Speaks connector\n" +
  (s.branches
    ? "This is a choose-your-path story. The story itself stays on the Plot Speaks server and arrives one moment at a time: the opening is below, and after each choice the player makes, call choose with the play id and their answer to get what happens next. You don't know what lies behind any choice, so never guess or hint at it. \"Plot Speaks, resume\" is choose with no answer: it returns where they are.\n\n"
    : isMystery(s)
    ? "The answer key stays on the Plot Speaks server, so you don't know the solution. When the player formally accuses someone, call check_accusation and give the verdict it returns. When they give up or ask for the full reveal, call reveal_solution.\n\n"
    : kindOfStory(s) === "game" ? (isWinddown(s) ? "The script below is the whole piece; read it as written, and end it quietly with no questions.\n\n" : `The rules below are the whole game; you run it as written. When it ends, ${RATE_ASK.replace(/^Then a/, "a")}\n\n`)
    : kindOfStory(s) === "campaign" ? "This is a campaign: you improvise from the world seed below, and Plot Speaks keeps the books. Roll every check, attack and save with roll and say the result as rolled. Record what happens with world_update the moment it happens, and obey what it refuses. In a later session the players give their resume code: call start_story with it as resume_code.\n\n"
    : kindOfStory(s) === "trivia" ? "This is a trivia game: you host it, and Plot Speaks holds every clue and answer. These rules come first, over anything below.\n- MODE: before the first question, ask once which way they want to play: the board (categories and points, like Jeopardy), quick fire (random questions one after another, no points, just a tally; good for driving), a streak (quick fire until the first miss), or they can just say how long they've got and the game is sized to fit. If the board below says SIZED FOR, the choice is made: don't ask. A time (\"ten minutes\"): call game_question with category \"10 minutes\" (or pass minutes to start_story if they said it up front). A streak: call game_question with category \"streak\". Quick fire: call game_question with category \"random\" for the first question; every game_answer reply then carries the next question, so keep calling game_answer and never call game_question or game_board again until the game is over. The board: when a player names a category and value, call game_question at once. A player stays in their category until they name another: the game_answer reply already carries the next clue in that category (Capitals 100 done, then Capitals 200), so read the ruling and then that clue at once. Never ask whether they want the next one or which value. Only when a category is cleared do you ask which category next, and if they name another category any time, call game_question with it. Every game_answer reply lists what is left, so don't call game_board between turns, only after a pause or resume.\n- CLUES: read each clue exactly as game_question or game_answer gave it, word for word. Never reword it, merge it with another clue, or ask a question from memory: the board rules the clue it dealt, and a reworded or swapped question gets a right answer ruled wrong. Never add your own opinion of whether an answer is right: only the ruling counts, and a player who disagrees can challenge.\n- NEVER say you're checking, looking something up, fetching or calling anything, and never mention tools: just read the clue or the ruling.\n- A short reply (\"yes\", \"continue\", \"next\", \"go on\", \"another\") is a complete answer: carry on at once; never ask the player to say it again in a full sentence.\n- SOUNDS: a ruling opens with a sound word, \"Ding!\" for a right answer and \"Bzzt.\" for a wrong one. Say it as a short, bright (or flat) sound in your own voice, never spelled out or explained, then the ruling. This is the one exception to any rule below about sound effects. If the player says \"no sounds\" or finds them annoying, drop them for the rest of the game.\n- Keep each turn to a few words of patter and the clue or ruling.\n\n"
    : "The hidden scenes stay on the Plot Speaks server. When the script calls for a cue, call get_cue and narrate its read-aloud part.\n\n") +
  "**What the player knows.** Only what they have heard in play. The cast table, the timeline and the scene notes below are what characters can say when asked and what places hold when searched, not facts the player already has. Never state, summarise or refer to any of it until the player asks the person or does the action that reveals it. If you mention something they haven't learned yet, don't explain it or add to it: say \"You haven't come across that yet. Who would you like to ask?\" and go on.\n\n" +
  "**No signal.** If a Plot Speaks call fails, say so in one sentence, keep narrating from this script, and try again when the player is ready; the play id still works. Never invent a verdict, a cue or a reveal.\n\n" +
  (s.testing
    ? "**This one is new and being tested.** Say so in one short sentence before you begin. At the end, before anything else, ask: \"This one's still being tested. Did it pass your test, or is there something we should improve?\" Then call rate_story with verdict \"passed\" or \"needs_work\" and, if they said what to improve or what they liked, their words as feedback (stars too, if they give a rating; a verdict alone is fine). Ask especially about anything confusing or anything that didn't work. If they decline (\"no thanks\", \"skip\") or don't say whether it passed, don't call rate_story and don't say you recorded anything: just thank them and move on.\n\n"
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
  return visibleTo(ctx, (await allStories(ctx)).filter((s) => !s.preview && inSeason(s)));
}
/** A weekly season: the date chapter n opens, or null when it's already out (or the story isn't weekly). */
function chapterOpens(s: { release?: Record<string, string> }, n: number, now = new Date()): string | null {
  const d = s.release?.[String(n)];
  return d && d > now.toISOString().slice(0, 10) ? d : null;
}
const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
/** How far a weekly season has got: "chapter 2 of 6 out now; chapter 3 on Wednesday, November 4". */
function seasonLine(s: Story): string {
  if (!s.release) return "";
  const total = s.story_connector?.length ?? 1;
  let out = 1;
  for (let n = 2; n <= total; n++) if (!chapterOpens(s, n)) out = n;
  const next = out < total ? s.release[String(out + 1)] : null;
  return `a weekly season: chapter ${out} of ${total} out now${next ? `, chapter ${out + 1} on ${longDate(next)}` : ", all out"}`;
}

/** A seasonal story (catalog.json "seasonal") is listed only inside its window, which may wrap the new year. */
function inSeason(s: { season?: { from: string; to: string } }, now = new Date()): boolean {
  if (!s.season) return true;
  const md = now.toISOString().slice(5, 10);
  const { from, to } = s.season;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}
const seasonEnd = (s: { season?: { from: string; to: string } }) => {
  if (!s.season) return "";
  const [m, d] = s.season.to.split("-").map(Number);
  return new Date(Date.UTC(2000, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
};
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
  // History rows name what was played anywhere; in ChatGPT the family stories' titles stay out.
  const familySlugs = async () => (gpt ? new Set((await allStories(ctx)).filter(isFamilyStory).map((s) => s.slug)) : new Set<string>());
  const forClient = async <T extends { story: string }>(rows: T[]) => { const fam = await familySlugs(); return fam.size ? rows.filter((r) => !fam.has(r.story)) : rows; };
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
      // What's new (plan 2026-10-19, item 6): a signed-in player hears each line once (users.news_seen
      // holds the newest id they've heard); anyone else hears the newest line, which is all the
      // connector can know. At most two lines, newest first.
      let fresh: { id: string; line: string }[] = news.slice(0, 1);
      if (ctx.userId) {
        const recent = await forClient(await historyOf(ctx.db, ctx.userId, 3));
        if (recent.length) {
          const played = await playedSlugs(ctx.db, ctx.userId);
          const unplayed = all.filter((s) => !played.has(s.slug)).slice(0, 3).map((s) => s.title);
          // A weekly season they were waiting on, now out.
          const waited = recent.map((h) => ({ h, n: Number(/^waiting for chapter (\d+)/.exec(h.outcome ?? "")?.[1] ?? 0) })).find((x) => x.n && all.some((s) => s.slug === x.h.story && !chapterOpens(s, x.n)));
          back = `${waited ? `NEW CHAPTER: chapter ${waited.n} of ${waited.h.title} is out now; tell them first. To play it: start_story with slug ${waited.h.story}, chapter ${waited.n} and play id ${waited.h.play_id}.\n` : ""}WELCOME BACK (they've played before; skip the intro unless they ask): last time, ${recent[0].title}${recent[0].outcome ? ` (${recent[0].outcome})` : ""}.${unplayed.length ? ` Not played yet: ${unplayed.join(", ")}.` : ""} list_stories with not_played: true lists everything they haven't played.`;
        }
        try {
          const row = await ctx.db?.prepare("SELECT news_seen FROM users WHERE id = ?").bind(ctx.userId).first<{ news_seen: string | null }>();
          fresh = news.filter((n) => !row?.news_seen || n.id > row.news_seen).slice(0, 2);
          if (fresh.length && news[0]?.id !== row?.news_seen) await ctx.db?.prepare("UPDATE users SET news_seen = ? WHERE id = ?").bind(news[0].id, ctx.userId).run();
        } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); fresh = news.slice(0, 1); }
      }
      return text([
        back,
        fresh.length ? `WHAT'S NEW (say it in one breath after the welcome, then move on; skip it if they've asked for something specific):\n${fresh.map((n) => `- ${n.line}`).join("\n")}` : null,
        (skip_intro || back) && !instructions ? null : `INTRO (to say aloud, in your own narrator voice):\n${OPEN_INTRO}`,
        instructions ? OPEN_HOW : null,
        `QUESTION (to ask next):\n${OPEN_QUESTION}`,
        `MENU (for when they want to hear the stories; one category at a time works best by voice):\n${openMenu(all)}`,
        "NEXT STEPS: to play a story they pick, call start_story with its title. If they aren't sure, call pick_for_me with their mood, how long they have and who is playing. For the full list, call list_stories (it takes a kind). To write their own, call write_story. If they ask for the instructions later, call open_plot_speaks with instructions: true.",
      ].filter(Boolean).join("\n\n"));
    },
  );

  server.registerTool(
    "pick_for_me",
    {
      title: "Pick something for me",
      annotations: { ...READ_ONLY, title: "Pick something for me" },
      description: "Suggests ONE Plot Speaks story or game to play now, from the player's mood, the time they have and who is playing. Use it when they aren't sure what to play.",
      inputSchema: {
        mood: z.string().max(200).optional().describe("The mood or kind of thing, in their words, e.g. spooky, light, a mystery, something calm"),
        minutes: z.number().int().min(1).max(600).optional().describe("How long they have"),
        players: z.number().int().min(1).max(12).optional().describe("How many are playing"),
        all_ages: z.boolean().optional().describe("True to keep it suitable for every age (nothing rated above PG)"),
      },
    },
    async ({ mood, minutes, players, all_ages: kids }) => {
      const played = ctx.userId ? await playedSlugs(ctx.db, ctx.userId) : undefined;
      const ranked = pickStories(await catalog(ctx), { mood, minutes, players, kids, played });
      log("pick_for_me", { mood: Boolean(mood), minutes: minutes ?? null, players: players ?? null, kids: Boolean(kids), found: ranked.length });
      if (!ranked.length) return text("Nothing fits all of that. Ask which matters most (the time, the players or the mood), then call pick_for_me again with less.");
      const [top, next] = ranked;
      return text(`PICK (offer just this one, in a sentence or two, using its pitch): ${listLine(top)}\nPitch: ${pitchOf(top)}\nIf they say yes, call start_story with slug ${top.slug}${kindOfStory(top) === "trivia" && minutes ? ` and minutes ${minutes}` : ""}.${next ? ` If they'd like something else, offer ${next.title} (${next.slug}) instead.` : ""}`);
    },
  );

  server.registerTool(
    "list_stories",
    {
      title: "List stories",
      annotations: { ...READ_ONLY, title: "List stories" },
      description: "Lists the Plot Speaks stories and games that can be played by voice, with length and number of players, optionally for one kind (mysteries, adventures, choose-your-path stories, trivia, games, open worlds and campaigns) or, within mysteries, classic or dark.",
      // Optional inputs rather than none: one client called the input-less version before loading it.
      inputSchema: {
        kind: z.enum(KIND_ORDER).optional().describe("Only list this kind: mystery, adventure, branching (choose your path), trivia, game or campaign (open worlds with no set ending, and D&D-style campaigns)"),
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
          if (!s) continue;
          const st = await loadTrivia(ctx.db, id);
          const board = s.trivia ?? (s.slug === TEAM_TRIVIA && st?.team ? teamBoard(st.team) : null);
          if (board && st?.asked.length) await rememberClues(ctx, seenKey(s.slug, st), dealtBoard(board, st), st.asked);
        } catch { /* best effort */ }
      }
      log("claim_plays", { asked: play_ids.length, claimed: r.claimed.length, skipped: r.skipped });
      const fam = await familySlugs();
      const titles = [...new Set(r.claimed.filter((slug) => !fam.has(slug)).map((slug) => bySlug.get(slug)?.title ?? slug))];
      return text(r.claimed.length
        ? `Added to their account: ${titles.length ? titles.join(", ") : `${r.claimed.length} earlier play${r.claimed.length === 1 ? "" : "s"}`}.${r.skipped ? ` ${r.skipped} couldn't be added (not found, or already on another account).` : ""} Their history and "not played yet" now include them.`
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
      const rows = await forClient(await historyOf(ctx.db, ctx.userId, limit ?? 15));
      if (!rows.length) return text("Nothing played yet on this account.");
      const prof = await profileOf(ctx.db, ctx.userId);
      const pl = prof ? profileLine(prof) : "";
      return text(`${pl ? `${pl}\n\n` : ""}PLAYED (newest first):\n${rows.map((r) => `- ${r.title} (${r.story}; ${KIND_NAMES[(KIND_ORDER as readonly string[]).includes(r.kind) ? r.kind as KindId : "mystery"].toLowerCase()}), ${new Date(r.started_at).toISOString().slice(0, 10)}: ${r.outcome ?? "not finished"}`).join("\n")}`);
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
        team: z.string().max(80).optional().describe("For Team Trivia: the team the player named, in their words (a city, a name, a nickname or an abbreviation)"),
        minutes: z.number().int().min(1).max(600).optional().describe("For a trivia game: how long the player has (their drive), to size the game to it"),
        path_code: z.string().max(80).optional().describe("For a choose-your-path story: the three-word path code a friend got at its ending, to follow their choices"),
        versus_code: z.string().max(80).optional().describe("For a trivia board: the three-word code a friend got at the end of their game, to play the same board and compare scores (pass slug \"versus\"; the code names the game)"),
      },
    },
    async ({ slug, chapter, play_id, resume_code, new_campaign, team: teamIn, minutes, versus_code, path_code }) => {
      // A shared path: the code names the story and carries the choices.
      let shared: { story: string; choices: string[]; ending: string } | null = null;
      if (path_code?.trim() && ctx.db) {
        try {
          const row = await ctx.db.prepare("SELECT story, choices, ending FROM path_codes WHERE code_hash = ?").bind(await codeHash(normCode(path_code))).first<{ story: string; choices: string; ending: string }>();
          if (row) shared = { story: row.story, choices: JSON.parse(row.choices) as string[], ending: row.ending };
        } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
        if (!shared) return text(`No path has the code "${path_code.trim().slice(0, 60)}" (codes last 30 days). Ask the player to say it again word by word, or start the story fresh.`);
      }
      // Head-to-head: the code names the board (and team) and carries the deal, so it overrides the slug.
      const vs = versus_code?.trim() ? await loadVersus(ctx.db, versus_code) : null;
      if (versus_code?.trim() && !vs) return text(`No finished board has the code "${versus_code.trim().slice(0, 60)}" (codes last 30 days). Ask the player to say it again word by word, or start a game without it.`);
      const team = vs?.seed.team ?? teamIn;
      const daily = vs?.seed.daily ?? (!vs && DAILY_WORDS.test(slug.trim()) ? todayUtc() : null);
      const r = await resolveStory(ctx, shared ? shared.story : vs ? vs.story : daily ? dailySlug(daily) : slug);
      log("start_story", { found: r.s?.slug ?? null, chapter: chapter ?? 1, resume: Boolean(resume_code), team: Boolean(team) });
      if (!r.s) return fail(r.error);
      const s = r.s;
      // Team Trivia: the board belongs to the team the player named (Ben, 2026-10-19).
      if (s.slug === TEAM_TRIVIA) {
        const script = `You are the narrator for "${s.title}" (you host it). Story slug: ${s.slug}.\n\n${prefaceFor(s)}${(s.story_connector?.[0]) ?? s.story}`;
        if (!team?.trim()) {
          log("team_trivia", { outcome: "ask" });
          return text(`${script}\n\nNO TEAM YET: ask which team they'd like (any team in ${LEAGUES_COVERED.join(", ")}), then call start_story again with slug ${s.slug} and the team's name as team.`);
        }
        const vsTeam = vs?.seed.team ? teamBySlug(vs.seed.team) : null;
        // A rivalry: "Yankees vs Red Sox" plays both teams' boards side by side.
        const halves = !vsTeam ? team.split(/\s+(?:vs\.?|versus|v\.?|against)\s+/i).map((x) => x.trim()).filter(Boolean) : [];
        const rival = halves.length === 2 ? halves.map((h) => resolveTeam(h)) : null;
        if (rival && rival.every((r) => "team" in r)) {
          const [ta, tb] = rival.map((r) => (r as { team: Team }).team);
          const b = rivalryBoard(ta, tb);
          const playId = crypto.randomUUID();
          await record(ctx, "INSERT INTO plays (id, story, client, tester, started_at, user_id) VALUES (?, ?, ?, ?, ?, ?)", playId, s.slug, ctx.client, ctx.tester ? 1 : 0, Date.now(), ctx.userId);
          await noteStart(ctx.db, ctx.userId, { play_id: playId, story: s.slug, title: `${s.title}: ${ta.short} vs ${tb.short}`, kind: kindOfStory(s) });
          const st = { ...newTrivia(b, new Set()), team: ta.slug, board: b };
          if (ctx.db) { try { await saveTrivia(ctx.db, playId, st).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); } }
          const watch = await watchCode(ctx.db, playId);
          log("team_trivia", { outcome: "rivalry", teams: `${ta.slug}|${tb.slug}` });
          return text(`${script}\n\nPlay id: ${playId} (pass it to game_board, game_question, game_answer, game_challenge and rate_story; team_roster takes a team's name).\n\n## This game\nRIVALRY: ${ta.name} against ${tb.name}. Four categories, each team's Then and Now, and a final about both. Nickname for ${ta.short}: ${ta.nickname || ta.short}; for ${tb.short}: ${tb.nickname || tb.short}. Play it up like a rivalry, kindly.\n\n## The board\n${watchNote(watch)}${renderBoard(dealtBoard(b, st), st)}`);
        }
        const found = vsTeam ? { team: vsTeam } : resolveTeam(team);
        if ("candidates" in found) {
          log("team_trivia", { outcome: "ambiguous", n: found.candidates.length });
          return text(`Several teams fit "${team.trim().slice(0, 60)}": ${found.candidates.map(teamLine).join("; ")}. Ask which one, then call start_story again with that team's full name.`);
        }
        if ("none" in found) {
          log("team_trivia", { outcome: "unsupported" });
          return text(`"${team.trim().slice(0, 60)}" isn't in the Team Trivia database yet. Say so plainly, and that it covers ${LEAGUES_COVERED.join(", ")}. Offer to send a request for that team: if they say yes, call request_team with its name. Then offer another team.`);
        }
        const t = found.team;
        const playId = crypto.randomUUID();
        await record(ctx, "INSERT INTO plays (id, story, client, tester, started_at, user_id) VALUES (?, ?, ?, ?, ?, ?)", playId, s.slug, ctx.client, ctx.tester ? 1 : 0, Date.now(), ctx.userId);
        await noteStart(ctx.db, ctx.userId, { play_id: playId, story: s.slug, title: `${s.title}: ${t.name}`, kind: kindOfStory(s) });
        // Today's roster as a Roster category ("name the player"), when ESPN answers; not for a head-to-head (the friend's board had none).
        const roster = vs ? null : await rosterCategory(t);
        const teamB: TriviaBoard = roster ? { categories: [...t.trivia.categories.filter((c) => !c.final), roster, ...t.trivia.categories.filter((c) => c.final)] } : t.trivia;
        const dealt = withVersus({ ...newTrivia(teamB, vs ? new Set() : await seenClues(ctx, `${TEAM_TRIVIA}/${t.slug}`)), team: t.slug, ...(roster ? { board: teamB } : {}) }, vs);
        const sized = minutes && !vs ? sizeGame(teamB, dealt, minutes) : null;
        const st = sized?.state ?? dealt;
        if (ctx.db) { try { await saveTrivia(ctx.db, playId, st).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); } }
        log("team_trivia", { outcome: "start", team: t.slug, league: t.league, minutes: minutes ?? null });
        const watch = await watchCode(ctx.db, playId);
        return text(`${script}\n\nPlay id: ${playId} (pass it to game_board, game_question, game_answer, game_challenge and rate_story; team_roster takes the team's name).\n\n## This game\n${teamIntro(t)}\n\n## The board\n${roster ? "ROSTER: a third category, Roster, is today's players from ESPN: name the player from their position, then their number, then their first initial.\n\n" : ""}${watchNote(watch)}${versusNote(st)}${sized ? sized.text : renderBoard(dealtBoard(teamB, st), st)}`);
      }
      // Carrying on a campaign: by its code, or, for a signed-in player, their latest one of this
      // story (unless they asked for a new one). The same play, its world, and the script.
      if (kindOfStory(s) === "campaign" && (resume_code || (ctx.userId && !new_campaign))) {
        const c = await campaignPlay(s.slug, undefined, resume_code);
        if ("error" in c && resume_code) return fail(c.error);
        const cWatch = "error" in c ? null : await watchCode(ctx.db, c.playId);
        if (!("error" in c)) return text(
          `${watchNote(cWatch, FOLLOW)}You are the narrator for "${s.title}", carrying on a campaign${resume_code ? "" : " (found on their account; if they'd rather start over, call start_story with new_campaign: true)"}. Story slug: ${s.slug}. Play id: ${c.playId} (pass it to world_update, world_recall and rate_story).${resume_code ? ` The resume code stays "${normCode(resume_code)}".` : ""}\n\n` +
          `${prefaceFor(s)}${(s.story_connector?.[0]) ?? s.story}\n\n## Where the campaign stands\n${recall(c.w, { open: isOpenWorld(c.s) })}\n\nGive the players a short spoken recap of the story so far, then ask what they do.`,
        );
      }
      const n = chapter ?? 1;
      const parts = s.story_connector?.length ? s.story_connector : [s.story];
      if (n > parts.length) return fail(`"${s.title}" has ${parts.length === 1 ? "one chapter" : `${parts.length} chapters`}; call start_story without chapter to play it.`);
      const opensOn = chapterOpens(s, n);
      if (opensOn) {
        log("start_story", { story: s.slug, chapter: n, outcome: "not_out_yet" });
        if (ctx.userId && play_id) await noteOutcome(ctx.db, ctx.userId, play_id, `waiting for chapter ${n}`);
        return text(`CHAPTER ${n} OF "${s.title}" ISN'T OUT YET: it arrives on ${longDate(opensOn)}. Tell the player warmly, give the chapter's recap if they'd like a reminder of where things stand, and say that next time they say "Plot Speaks, continue ${s.title}, chapter ${n}"${ctx.userId ? " (their place is saved on their account)" : `, with the play id ${play_id ?? "from this chapter"}`}. Offer something else to play meanwhile.`);
      }
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
      const watch = await watchCode(ctx.db, playId);
      // A choose-your-path story starts its state here and hands out the opening node only.
      let opening = "";
      if (kindOfStory(s) === "campaign") {
        // A new campaign: an empty world and a spoken resume code for the next session.
        let code = newCode();
        const w = { ...newWorld(), code: undefined };
        if (ctx.db) {
          // The world is saved on its own, so a code problem can't lose it; a code already taken
          // (rare) is replaced by a fresh one, and the players are only ever told a code that was stored.
          try { await saveWorld(ctx.db, playId, w).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
          for (let tries = 0; ; tries++) {
            const r = await ctx.db.prepare("INSERT OR IGNORE INTO campaign_codes (code_hash, play_id, created_at) VALUES (?, ?, ?)").bind(await codeHash(code), playId, Date.now()).run().catch((e) => { log("db_error", { message: String(e).slice(0, 200) }); return null; });
            if (!r || r.meta.changes > 0 || tries >= 4) break;
            code = newCode();
          }
        }
        opening = `\n\n## This campaign\nRESUME CODE: "${code}". Tell the players now, and again at the end of every session: next time, in a new chat, they say "Continue my Plot Speaks campaign ${s.title}, code ${code}" and you call start_story with resume_code.\n\n${recall(w, { open: isOpenWorld(s) })}`;
      } else if (s.trivia) {
        // Deal this game's clues from the pools, avoiding ones a signed-in player has seen.
        // The daily: the same deal for everyone today (seeded, history ignored), the whole board.
        const dealt = withVersus(daily ? { ...newTrivia(s.trivia, new Set(), seeded(`daily|${daily}`)), daily } : newTrivia(s.trivia, vs ? new Set() : await seenClues(ctx, s.slug)), vs);
        // Sized to the drive when the player said how long they have (sizeGame); otherwise the host asks the mode.
        const sized = minutes && !daily && !vs ? sizeGame(s.trivia, dealt, minutes) : null;
        const st = sized?.state ?? dealt;
        if (ctx.db) {
          try { await saveTrivia(ctx.db, playId, st).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
        }
        const dailyNote = daily ? `TODAY'S BOARD (${daily}): everyone who plays today gets these same clues, and at the end the host hears how many have played and the top score. It's the board (not quick fire): don't ask which way to play.\n\n` : "";
        opening = `\n\n## The board\n${watchNote(watch)}${versusNote(st)}${dailyNote}${sized ? sized.text : renderBoard(dealtBoard(s.trivia, st), st)}`;
      } else if (s.picks?.length) {
        // One hidden pick per play (a thing to guess, a riddle case, a question pack): for a signed-in
        // player, one they haven't been dealt before while any are left; it joins what they've seen.
        const seen = await seenClues(ctx, s.slug);
        const pickId = (p: string) => `pick:${p.slice(0, 60)}`;
        const fresh = s.picks.filter((p) => !seen.has(pickId(p)));
        const pool = fresh.length ? fresh : s.picks;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (ctx.db && ctx.userId) { try { await ctx.db.prepare("INSERT OR IGNORE INTO user_seen (user_id, story, clue, at) VALUES (?, ?, ?, ?)").bind(ctx.userId, s.slug, pickId(pick), Date.now()).run(); } catch { /* memory never breaks play */ } }
        opening = `\n\n## Your hidden pick for this play (only you have it)\n${pick}\n\nUse it exactly as the rules above say. Never say it, hint at it beyond the rules, or put it in writing until the rules say to reveal it. (In a game with a mode where it isn't needed, ignore it in that mode.)`;
      }
      if (s.branches) {
        const st = { ...initialState(s.branches), ...(shared ? { follow: shared.choices } : {}) };
        if (ctx.db) {
          try { await saveStateStatement(ctx.db, playId, st).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
        }
        opening = `\n\n## The opening\n${shared ? `A SHARED PATH: the player is following a friend's choices, which ended at "${shared.ending}". Tell them so in a sentence (not the ending's name). At each choice you'll be told what the friend chose; "next" takes the same turn, and any other choice goes their own way.\n\n` : ""}${renderNode(s.branches, st, { title: s.title })}`;
      }
      const cues = Object.keys(s.cues ?? {}).length ? ", get_cue" : "";
      const passTo = kindOfStory(s) === "campaign" ? "world_update, world_recall and rate_story" : s.branches ? `choose and rate_story` : s.trivia ? "game_board, game_question, game_answer, game_challenge and rate_story" : kindOfStory(s) === "game" ? "rate_story" : `check_accusation, reveal_solution${cues} and rate_story${more}`;
      return text(
        `You are the narrator for "${s.title}". The user chose to play this through Plot Speaks; the script below is the game they asked for, and their own requests come first. ` +
        `Story slug: ${s.slug}. Play id: ${playId} (pass it to ${passTo}).\n\n${s.trivia ? "" : watchNote(watch, FOLLOW)}${prefaceFor(s)}${parts[n - 1]}${opening}`,
      );
    },
  );

  server.registerTool(
    "choose",
    {
      title: "Make a choice",
      // Not read-only: it moves the play on and records where it is.
      annotations: { ...RECORDS, title: "Make a choice" },
      description: "Moves a Plot Speaks choose-your-path story on by the player's choice and returns what happens next: the scene to narrate and the choices that follow, or the ending. With no choice it returns where the play is now and the path so far (for resuming). With go_back it returns to the last choice so the player can choose again.",
      inputSchema: {
        slug: SLUG.describe("The story slug"),
        play_id: PLAY_ID.describe("The play id from start_story"),
        choice: z.string().max(200).optional().describe("The player's answer: the choice's number, or their words for it"),
        go_back: z.boolean().optional().describe("True when the player wants to go back to their last choice and choose again (after an ending, or any time they ask)"),
      },
    },
    async ({ slug, play_id, choice, go_back }) => {
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
      if (go_back) {
        const back = rewind(s.branches, st);
        log("choose", { story: s.slug, outcome: back ? "back" : "back_at_start", node: back?.node ?? st.node });
        if (!back) return text(`They're at the very first choice already.\n\n${renderNode(s.branches, st, { title: s.title })}`);
        if (ctx.db) { try { await saveStateStatement(ctx.db, play_id, back).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); } }
        return text(`BACK ONE CHOICE (say so in a few words, in the story's voice, then read this moment again):\n\n${renderNode(s.branches, back, { title: s.title })}`);
      }
      if (!choice || !choice.trim()) {
        log("choose", { story: s.slug, outcome: "resume", node: st.node });
        return text(renderNode(s.branches, st, { resume: true, title: s.title }));
      }
      if (st.ended) return text(renderNode(s.branches, st, { title: s.title }));
      const node = s.branches.nodes[st.node];
      const open = node ? branchOffered(node, st.flags) : [];
      const fc = st.follow && /^(next|follow|follow it|same|same way|continue|go on|yes|keep going)\.?$/i.test(choice.trim()) ? followChoice(s.branches, st) : null;
      const picked = fc ?? matchChoice(open, choice);
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
      let pathNote = "";
      if (ending && db && next.path.length) {
        try {
          for (let tries = 0; tries < 4; tries++) {
            const code = newCode();
            const r = await db.prepare("INSERT OR IGNORE INTO path_codes (code_hash, story, choices, ending, created_at) VALUES (?, ?, ?, ?, ?)").bind(await codeHash(code), s.slug, JSON.stringify(next.path.map((p) => p.choice)), ending.slice(0, 80), Date.now()).run();
            if (r.meta.changes > 0) { pathNote = `\n\nYOUR PATH (offer once to read it; if they want it, read it as written): ${pathSummary(next, ending)}\nPATH CODE: "${code}". Offer it too: a friend can say "Plot Speaks, play ${s.title} on path ${code}" to follow the same choices, or take another turn anywhere. It lasts 30 days.`; break; }
          }
        } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
      }
      return text(renderNode(s.branches, next, { title: s.title }) + pathNote);
    },
  );

  // ------------------------------------------------------------ trivia (kind: trivia)
  // One helper runs every trivia step: find the story and its play, load the state, apply the step,
  // save the state and log the event, all for this story's own play only.
  const triviaStep = async (slug: string, play_id: string, tool: string, run: (b: NonNullable<Story["trivia"]>, st: ReturnType<typeof newTrivia>) => Step | Promise<Step>) => {
    const r = await resolveStory(ctx, slug);
    if (!r.s) { log(tool, { found: null }); return fail(r.error); }
    const s = r.s;
    if (!s.trivia && s.slug !== TEAM_TRIVIA) return fail(`${s.title} isn't a trivia game.`);
    let st: ReturnType<typeof newTrivia> | null = null;
    let ownPlay = false;
    try {
      const play = ctx.db ? await ctx.db.prepare("SELECT story FROM plays WHERE id = ?").bind(play_id).first<{ story: string }>() : null;
      ownPlay = play?.story === s.slug;
      if (ownPlay) st = await loadTrivia(ctx.db, play_id);
    } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
    if (!ownPlay) return fail(`I couldn't find that game of ${s.title}. Call start_story to begin it; it returns a play id.`);
    const board = s.trivia ?? st?.board ?? (st?.team ? teamBoard(st.team) : null);
    if (!board) return fail(`${s.title} needs a team first: call start_story with slug ${s.slug} and the team's name as team.`);
    const state = st ?? newTrivia(board);
    const dealt = dealtBoard(board, state);
    // Alternatives upheld challenges taught the board (clue_aliases): merged into "also" for rulings
    // and challenges only, into copies, never into the bundled board.
    const aliases = ctx.db && (tool === "game_answer" || tool === "game_challenge") ? await learnedAliases(ctx.db, seenKey(s.slug, state)) : null;
    const view: TriviaBoard = aliases?.size
      ? { categories: dealt.categories.map((c) => ({ ...c, clues: c.clues.map((q) => { const extra = aliases.get(clueId(c.name, q)); return extra ? { ...q, also: [...q.also, ...extra] } : q; }) })) }
      : dealt;
    const out = await run(view, state);
    log(tool, { story: s.slug, error: Boolean(out.error), event: out.event?.verdict ?? null });
    if (out.error) return fail(out.text);
    // Real difficulty (migration 0022): a ruling on a clue (not a stepped clue's early step) counts toward
    // how often it is asked and got right. Estimates count too ("right" is within 15%).
    if (tool === "game_answer" && ctx.db && out.event?.kind === "trivia" && out.event.verdict && !/\|step$/.test(out.event.detail) && out.state.last) {
      const l = out.state.last;
      const cat = view.categories.find((c) => c.name === l.cat);
      const q = cat?.final ? cat.clues[0] : cat?.clues.find((x) => x.value === l.value);
      if (cat && q) {
        try {
          await ctx.db.prepare("INSERT INTO clue_stats (story, clue_id, asked, right) VALUES (?, ?, 1, ?) ON CONFLICT (story, clue_id) DO UPDATE SET asked = asked + 1, right = right + excluded.right")
            .bind(seenKey(s.slug, state), clueId(cat.name, q), out.event.verdict === "correct" ? 1 : 0).run();
        } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
      }
    }
    if (out.learn && ctx.db) {
      // At most five learned names per clue, so one dispute can't grow without limit.
      const id = clueId(out.learn.cat, out.learn.clue), key = seenKey(s.slug, state);
      try {
        const n = await ctx.db.prepare("SELECT count(*) AS n FROM clue_aliases WHERE story = ? AND clue_id = ?").bind(key, id).first<{ n: number }>();
        if ((n?.n ?? 0) < 5) await ctx.db.prepare("INSERT OR IGNORE INTO clue_aliases (story, clue_id, alias, at) VALUES (?, ?, ?, ?)").bind(key, id, out.learn.alias, Date.now()).run();
      } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
    }
    // A clue just ruled on joins a signed-in player's history, so later games deal around it.
    const ruled = out.state.asked.filter((k) => !state.asked.includes(k));
    if (ruled.length) await rememberClues(ctx, seenKey(s.slug, state), view, ruled);
    if (ctx.db) {
      // The ending is recorded once, on the step that clears the board, not on every call after it.
      const quickish = out.state.mode === "quick" || out.state.mode === "streak";
      const full = view.categories.filter((c) => !(quickish && c.final)).reduce((n, c) => n + c.clues.length, 0);
      // A sized quick fire ends at its cap; a streak ends on its first miss (or when the questions run out).
      const total = quickish && out.state.quickMax ? Math.min(full, out.state.quickMax) : full;
      const over = out.state.mode === "streak" ? Boolean(out.state.streakOver && !state.streakOver) : out.state.asked.length >= total && state.asked.length < total;
      const outcome = out.state.mode === "streak"
        ? `streak ${Object.values(out.state.scores).reduce((a, n) => a + n, 0)}`
        : `${out.state.mode === "quick" ? "quick fire" : "board cleared"}: ${Object.entries(out.state.scores).map(([n, v]) => `${n} ${v}`).join(", ").slice(0, 70) || "no points"}`;
      await recordBatch(ctx, over ? play_id : null, s.slug, (d) => [
        saveTrivia(d, play_id, out.state),
        ...(out.event ? [d.prepare(`INSERT INTO play_events (play_id, story, kind, detail, verdict, at) VALUES (${PLAY_OF}, ?, ?, ?, ?, ?)`).bind(play_id, s.slug, s.slug, out.event.kind, out.event.detail.slice(0, 120), out.event.verdict ?? null, Date.now())] : []),
        ...(over ? [d.prepare(`INSERT INTO play_events (play_id, story, kind, detail, at) VALUES (${PLAY_OF}, ?, 'ending', ?, ?)`).bind(play_id, s.slug, s.slug, outcome.split(":")[0], Date.now())] : []),
        ...(over && ctx.userId ? [d.prepare("UPDATE user_history SET outcome = ?, finished_at = ? WHERE user_id = ? AND play_id = ?").bind(outcome, Date.now(), ctx.userId, play_id)] : []),
        // The daily board: this play's best score joins the day's table (a signed-in replay replaces the earlier row).
        ...(over && out.state.daily && ctx.userId ? [d.prepare("DELETE FROM daily_scores WHERE day = ? AND user_id = ?").bind(out.state.daily, ctx.userId)] : []),
        ...(over && out.state.daily ? [d.prepare("INSERT OR REPLACE INTO daily_scores (play_id, day, user_id, name, score, at) VALUES (?, ?, ?, ?, ?, ?)").bind(play_id, out.state.daily, ctx.userId, ...(Object.entries(out.state.scores).sort((a, b) => b[1] - a[1])[0] ?? ["You", 0]), Date.now())] : []),
      ]);
      if (over) {
        const extra: string[] = [];
        const top = Object.entries(out.state.scores).sort((a, b) => b[1] - a[1])[0] as [string, number] | undefined;
        try {
          if (out.state.daily) {
            const row = await ctx.db.prepare("SELECT count(*) AS n, max(score) AS top FROM daily_scores WHERE day = ?").bind(out.state.daily).first<{ n: number; top: number | null }>();
            const lead = await ctx.db.prepare("SELECT name FROM daily_scores WHERE day = ? ORDER BY score DESC, at ASC LIMIT 1").bind(out.state.daily).first<{ name: string }>();
            extra.push(`TODAY'S BOARD: ${row?.n ?? 1} ${row?.n === 1 ? "game" : "games"} played today; the top score is ${row?.top ?? 0}${lead?.name ? ` (${lead.name})` : ""}. Say how this one compares.`);
          }
          if (top && out.state.versus) extra.push(versusResult(top, out.state.versus));
          // A finished board (not a quick fire or a streak, whose questions are drawn at random) gets a
          // code a friend can play against: the same deal, the top score to beat.
          if (top && !quickish) {
            const seed: VersusSeed = { deal: out.state.deal ?? {}, cats: out.state.cats, minutes: out.state.minutes, daily: out.state.daily, team: out.state.team };
            for (let tries = 0; tries < 4; tries++) {
              const code = newCode();
              const r = await ctx.db.prepare("INSERT OR IGNORE INTO board_codes (code_hash, story, seed, name, score, play_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(await codeHash(code), s.slug, JSON.stringify(seed), top[0].slice(0, 40), top[1], play_id, Date.now()).run();
              if (r.meta.changes > 0) { extra.push(`CHALLENGE CODE: "${code}". Tell ${top[0]} now: a friend can say "Plot Speaks, play against code ${code}" to play this same board and see who scores more. Say the code slowly, once. It lasts 30 days.`); break; }
            }
          }
        } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
        if (extra.length) return text(`${out.text}\n\n${extra.join("\n\n")}`);
      }
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

  server.registerTool(
    "team_roster",
    {
      title: "Team roster",
      annotations: { ...READ_ONLY, idempotentHint: false, title: "Team roster" },
      description: "Reads a sports team's current roster from ESPN for Plot Speaks Team Trivia: players by position with numbers, and the head coach. Takes the team's name as the player says it.",
      inputSchema: { team: z.string().min(1).max(80).describe("The team, as the player named it") },
    },
    async ({ team }) => {
      const found = resolveTeam(team);
      log("team_roster", { outcome: "team" in found ? "ok" : "candidates" in found ? "ambiguous" : "unsupported" });
      if ("candidates" in found) return fail(`Several teams fit "${team.trim().slice(0, 60)}": ${found.candidates.map(teamLine).join("; ")}. Ask which, then call team_roster with that team's full name.`);
      if ("none" in found) return fail(`"${team.trim().slice(0, 60)}" isn't in the Team Trivia database, so there's no roster for it. The leagues covered: ${LEAGUES_COVERED.join(", ")}.`);
      return text(await rosterText(found.team));
    },
  );
  server.registerTool(
    "request_team",
    {
      title: "Request a team",
      annotations: { ...RECORDS, title: "Request a team" },
      description: "Records a player's request for a sports team that Plot Speaks Team Trivia doesn't cover yet, for the people who maintain the database. Only after the player says they'd like it added.",
      inputSchema: { team: z.string().min(1).max(80).describe("The team they'd like added, with its league if they said it"), note: z.string().max(200).optional().describe("Anything else they said about it") },
    },
    async ({ team, note }) => {
      const detail = `${team.trim()}${note ? ` (${note.trim()})` : ""}`.slice(0, 200);
      await record(ctx, "INSERT INTO play_events (play_id, story, kind, detail, at) VALUES (NULL, ?, 'team_request', ?, ?)", TEAM_TRIVIA, detail, Date.now());
      log("request_team", { team: team.trim().slice(0, 60) });
      return text(`Request recorded: "${team.trim().slice(0, 60)}". Tell the player it has gone to the people who keep the database, and offer another team.`);
    },
  );

  // ------------------------------------------------------------ campaigns (kind: campaign)
  const campaignPlay = async (slug: string, play_id?: string, resume_code?: string): Promise<{ s: Story; playId: string; w: World } | { error: string }> => {
    const r = await resolveStory(ctx, slug);
    if (!r.s) return { error: r.error };
    if (kindOfStory(r.s) !== "campaign") return { error: `${r.s.title} isn't a campaign.` };
    const db = ctx.db;
    if (!db) return { error: "Campaigns aren't available on this server right now." };
    let id = play_id ?? "";
    // Wrong codes are counted per person (account, else address) for an hour, so codes can't be
    // found by trying them: ten misses and code lookups stop until the hour is up.
    const kv = ctx.env.OAUTH_KV as KVNamespace | undefined;
    const missKey = `codemiss:${ctx.userId ?? ctx.ip ?? "anon"}`;
    try {
      if (!id && resume_code) {
        const misses = kv ? Number((await kv.get(missKey)) ?? 0) : 0;
        if (misses >= 10) return { error: "Too many wrong codes in the last hour. Ask the players to check the code they wrote down, and try again later." };
        id = (await db.prepare("SELECT play_id FROM campaign_codes WHERE code_hash = ?").bind(await codeHash(resume_code)).first<{ play_id: string }>())?.play_id ?? "";
        // Our own tester key (the smoke tests send one wrong code a run) isn't counted: ten runs in an
        // hour locked the smoke test, and with it the deploy gate, out of campaign codes.
        if (!id && kv && !ctx.tester) await kv.put(missKey, String(misses + 1), { expirationTtl: 3600 }).catch(() => {});
      }
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
        hidden: z.boolean().optional().describe("True for a roll the story's rules keep secret from the players (a world clock, a hidden table); the result is for you only"),
      },
    },
    async ({ dice, why, hidden }) => {
      const r = rollDice(dice);
      log("roll", { ok: !("error" in r), hidden: Boolean(hidden) });
      if ("error" in r) return fail(r.error);
      return text(`${why ? `${String(why).slice(0, 80)}: ` : ""}${r.text} ${hidden ? "A hidden roll: use it as the story's rules say, and don't say it aloud; never change it." : "Say the result aloud as rolled; never change it."}`);
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
      return text(`Campaign play id: ${c.playId} (pass it to world_update).\n\n${recall(c.w, { open: isOpenWorld(c.s) })}\n\nGive the players a short spoken recap of the story so far, then ask what they do.`);
    },
  );
  const partySchema = z.object({
    // Generous limits here, clipping in world.ts (2026-10-17 QA): a too-long item used to fail the
    // whole call, losing every other change in it.
    name: z.string().min(1).max(80), class: z.string().max(100).optional(), level: z.number().int().min(1).max(5).optional(),
    hp: z.number().int().min(0).max(500).optional(), max_hp: z.number().int().min(1).max(200).optional(),
    damage: z.number().int().min(0).max(500).optional(), heal: z.number().int().min(0).max(500).optional(),
    max_slots: z.record(z.string(), z.number().int().min(0).max(4)).optional(), spend_slot: z.string().regex(/^[1-5]$/).optional(),
    conditions: z.array(z.string().max(400)).max(40).optional(), add_items: z.array(z.string().max(1000)).max(100).optional(),
    remove_items: z.array(z.string().max(1000)).max(100).optional(), gold: z.number().int().min(-1000000).max(1000000).optional(), remove: z.boolean().optional(),
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
        location: z.string().max(1000).optional().describe("Where the party is now (kept to 120 characters)"),
        day: z.number().int().min(1).optional().describe("The campaign day, if it moved on"),
        rest: z.enum(["short", "long"]).optional().describe("A short or long rest"),
        npcs: z.array(z.object({ name: z.string().min(1).max(200), status: z.string().max(100).optional(), note: z.string().max(4000).optional() })).max(60).optional().describe("People met or changed (status e.g. friendly, hostile, dead; notes kept to 160 characters)"),
        quests: z.array(z.object({ name: z.string().min(1).max(200), status: z.enum(["open", "done", "failed"]).optional(), note: z.string().max(4000).optional() })).max(60).optional().describe("Quests taken or changed (notes kept to 160 characters)"),
        note: z.string().max(4000).optional().describe("One line for the story so far (kept to 240 characters)"),
      },
    },
    async ({ slug, play_id, ...changes }) => {
      const c = await campaignPlay(slug, play_id);
      if ("error" in c) { log("world_update", { found: false }); return fail(c.error); }
      const { world, refused, done } = applyChanges(c.w, changes as WorldChanges, { open: isOpenWorld(c.s) });
      log("world_update", { story: c.s.slug, refused: refused.length, done: done.length });
      if (ctx.db) {
        try { await saveWorld(ctx.db, c.playId, world).run(); } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); return fail("The change couldn't be saved; try again in a moment."); }
      }
      return text([
        done.length ? `RECORDED:\n${done.map((d) => `- ${d}`).join("\n")}` : "Nothing changed.",
        refused.length ? `REFUSED (the rules don't allow it; narrate it differently):\n${refused.map((d) => `- ${d}`).join("\n")}` : "",
        recall(world, { open: isOpenWorld(c.s) }),
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
      // Records the scene reached when given the play id (plan 2026-10-21: the watch page's timeline), so it
      // is no longer read-only (review S7 made it read-only while it recorded nothing).
      annotations: { ...RECORDS, title: "Get a scene cue" },
      description: "Returns a cue from a Plot Speaks adventure: the scene text to narrate, and the scene's notes for the narrator. Pass the play id so a passenger following along sees the scene reached.",
      inputSchema: {
        slug: SLUG.describe("The story slug"),
        cue: z.string().max(8).regex(/^S?\d+[a-z]?$/i).describe("The cue id, e.g. S1 or S3b"),
        play_id: PLAY_ID.optional().describe("The play id from start_story"),
      },
    },
    async ({ slug, cue, play_id }) => {
      const r = await resolveStory(ctx, slug);
      const id = cue.toUpperCase().startsWith("S") ? cue.toUpperCase() : `S${cue.toUpperCase()}`;
      const c = r.s?.cues[id];
      log("get_cue", { story: r.s?.slug ?? null, cue: id, found: Boolean(c) });
      if (!r.s) return fail(r.error);
      const s = r.s;
      if (!c) return fail(`No cue ${id} in ${s.title}.${Object.keys(s.cues).length ? "" : " This story has no cues."}`);
      if (play_id && ctx.db) await record(ctx, `INSERT INTO play_events (play_id, story, kind, detail, at) VALUES (${PLAY_OF}, ?, 'cue', ?, ?)`, play_id, s.slug, s.slug, id, Date.now());
      const notes = [c.narrator_only, id === "S1" && s.listen_for ? `Follow-up cues to listen for during this story:\n${s.listen_for}` : null].filter(Boolean).join("\n\n");
      return text(`READ ALOUD (in your own narrator voice):\n${c.read_aloud}` + (notes ? `\n\nNARRATOR NOTES (not read aloud: they would spoil the scene):\n${notes}` : ""));
    },
  );

  server.registerTool(
    "rate_story",
    {
      title: "Rate a story",
      annotations: { ...RECORDS, title: "Rate a story" },
      description: "Saves a rating and feedback for a Plot Speaks story the user has just played: 1 to 5 stars, whether anything was given away too early, an optional comment about the story, optional feedback about the experience for the people who make Plot Speaks, and, for a story still being tested, the player's verdict (passed, or needs work). Needs the play id from start_story; one rating per play; stars or a verdict (or both).",
      inputSchema: {
        slug: SLUG.describe("The story slug"),
        stars: z.number().int().min(1).max(5).optional().describe("1 to 5 (optional when a verdict is given)"),
        verdict: z.enum(["passed", "needs_work"]).optional().describe("For a story being tested: \"passed\" if it passed the player's test, \"needs_work\" if something should be improved (put what, in their words, in feedback)"),
        spoiled: z.boolean().optional().describe("True if the player felt the narrator gave something away too early"),
        comment: z.string().max(500).optional().describe("The player's comment about the story, if any, in their words"),
        feedback: z.string().max(1000).optional().describe("Feedback about the experience (the narration, the connector, what to improve), if any, in the player's words; read by the people who make Plot Speaks"),
        play_id: PLAY_ID.describe("The play id from start_story"),
      },
    },
    async ({ slug, stars, verdict, spoiled, comment, feedback, play_id }) => {
      const r = await resolveStory(ctx, slug);
      if (!r.s) { log("rate_story", { found: null }); return fail(r.error); }
      const s = r.s;
      if (stars === undefined && !verdict) return fail("Give stars (1 to 5), a verdict (passed or needs_work), or both. Nothing was saved.");
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
      log("rate_story", { story: s.slug, stars: stars ?? null, verdict: verdict ?? null, spoiled: spoiled ?? null, tester, feedback: Boolean(feedback) });
      await recordBatch(ctx, play_id, s.slug, (d) => [
        ...(stars !== undefined ? [
          d.prepare("DELETE FROM ratings WHERE play_id = ?").bind(play_id),
          d.prepare("INSERT INTO ratings (play_id, story, stars, spoiled, comment, feedback, at, tester) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(play_id, s.slug, stars, spoiled === undefined ? null : spoiled ? 1 : 0, comment ?? null, feedback?.trim() || null, Date.now(), tester),
        ] : []),
        // A tester's verdict (migration 0011), one per play; the suggestion goes with it.
        ...(verdict ? [d.prepare("INSERT INTO test_verdicts (play_id, story, verdict, feedback, at, tester) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(play_id) DO UPDATE SET verdict = excluded.verdict, feedback = excluded.feedback, at = excluded.at")
          .bind(play_id, s.slug, verdict, feedback?.trim() || comment?.trim() || null, Date.now(), tester)] : []),
      ]);
      if (verdict) await noteOutcome(ctx.db, ctx.userId, play_id, verdict === "passed" ? "tested: passed" : "tested: needs work");
      const closing = " Then say: \"Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or play this one again?\"";
      const said = verdict ? (verdict === "passed" ? "Thanks, marked as passing their test" : "Thanks, marked as needing work") + (feedback ? ", with their suggestions" : "") + ". Tell the player it goes to the people who make Plot Speaks." : feedback ? "Thanks, rating and feedback saved. Tell the player their feedback goes to the people who make Plot Speaks." : "Thanks, rating saved.";
      return text(said + closing);
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
/** The user_seen key for a trivia play: a team's own key for Team Trivia, else the story slug. */
// Watch codes (plan 2026-10-19, item 18): two words that open the read-only view at plotspeaks.com/watch.
// Every play gets one (plan 2026-10-21); a play that already has a code (chapter 2, a resumed campaign) keeps it.
async function watchCode(db: D1Database | undefined, playId: string): Promise<string | null> {
  if (!db) return null;
  try {
    const had = await db.prepare("SELECT code FROM watch_codes WHERE play_id = ? AND created_at > ?").bind(playId, Date.now() - 86_400_000).first<{ code: string }>();
    if (had) return had.code;
  } catch { return null; }
  for (let tries = 0; tries < 4; tries++) {
    const code = newShortCode();
    try {
      const r = await db.prepare("INSERT OR IGNORE INTO watch_codes (code, play_id, created_at) VALUES (?, ?, ?)").bind(code, playId, Date.now()).run();
      if (r.meta.changes > 0) return code;
    } catch { return null; }
  }
  return null;
}
const watchNote = (code: string | null, what = "watch the board") => code
  ? `WATCH CODE: "${code}". Once, at the start and in one short sentence, mention that a passenger can ${what} on a phone at plotspeaks.com/watch with the code ${code}. Don't repeat it unless asked.\n\n`
  : "";
const FOLLOW = "follow along";
const WATCH_GENRE: Record<KindId, string> = { mystery: "Murder mystery", adventure: "Adventure", branching: "Choose your path", trivia: "Trivia", game: "Party game", campaign: "Campaign" };
/** GET /api/play/<code>: the board (games.ts watchView) or, for any other play, its timeline (timelineView); else 404. */
async function watchApi(env: Env, code: string): Promise<Response> {
  const db = env.DB;
  const c = normCode(decodeURIComponent(code).replace(/-/g, " "));
  if (!db || !/^[a-z]+ [a-z]+$/.test(c)) return apiJson({ error: "not_found" }, 404);
  try {
    const row = await db.prepare("SELECT w.play_id, p.story FROM watch_codes w JOIN plays p ON p.id = w.play_id WHERE w.code = ? AND w.created_at > ?").bind(c, Date.now() - 86_400_000).first<{ play_id: string; story: string }>();
    if (!row) return apiJson({ error: "not_found" }, 404);
    const s = STORIES.find((x) => x.slug === row.story);
    if (!s) return apiJson({ error: "not_found" }, 404);
    const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };
    const st = await loadTrivia(db, row.play_id);
    const b = s.trivia ?? st?.board ?? (st?.team ? teamBoard(st.team) : null);
    if (st && b) {
      const team = st.team ? teamBySlug(st.team)?.name ?? null : null;
      return new Response(JSON.stringify({ kind: "trivia", title: team ? `${s.title}: ${team}` : s.title, ...watchView(dealtBoard(b, st), st) }), { headers });
    }
    // Every other play (plan 2026-10-21): only what has been said aloud, never the script or the key.
    const play = await db.prepare("SELECT started_at FROM plays WHERE id = ?").bind(row.play_id).first<{ started_at: number }>();
    const ev = await db.prepare("SELECT kind, detail, verdict, at FROM play_events WHERE play_id = ? AND kind IN ('cue', 'accusation', 'reveal', 'ending') ORDER BY at LIMIT 60").bind(row.play_id).all<WatchEvent>();
    const k = kindOfStory(s);
    const bs = s.branches ? await loadState(db, row.play_id) : null;
    const w = k === "campaign" ? await loadWorld(db, row.play_id) : null;
    const mins = s.duration_minutes || null;
    const view = timelineView({ startedAt: play?.started_at ?? Date.now(), events: ev.results ?? [], path: bs ? bs.path.map((x) => x.choice) : undefined, ended: bs?.ended, world: w });
    const genre = isWinddown(s) ? "Wind-down" : WATCH_GENRE[k];
    const thin = k === "game" || (k === "adventure" && !Object.keys(s.cues ?? {}).length);
    return new Response(JSON.stringify({ kind: "timeline", title: s.title, slug: s.slug, genre, minutes: mins, thin, ...view }), { headers });
  } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); return apiJson({ error: "unavailable" }, 503); }
}

// Head-to-head (plan 2026-10-19, item 7): a finished board's deal and top score, kept under a three-word code.
type VersusSeed = { deal: Record<string, number>; cats?: string[]; minutes?: number; daily?: string; team?: string };
type Versus = { story: string; seed: VersusSeed; name: string; score: number };
async function loadVersus(db: D1Database | undefined, code: string): Promise<Versus | null> {
  if (!db) return null;
  try {
    const row = await db.prepare("SELECT story, seed, name, score FROM board_codes WHERE code_hash = ?").bind(await codeHash(normCode(code))).first<{ story: string; seed: string; name: string; score: number }>();
    return row ? { story: row.story, seed: JSON.parse(row.seed) as VersusSeed, name: row.name, score: row.score } : null;
  } catch { return null; }
}
/** This play dealt exactly as the code's board was, remembering whose score it is up against. */
function withVersus<T extends ReturnType<typeof newTrivia>>(st: T, vs: Versus | null): T {
  if (!vs) return st;
  return { ...st, deal: vs.seed.deal, cats: vs.seed.cats, minutes: vs.seed.minutes, daily: vs.seed.daily, versus: { name: vs.name, score: vs.score } };
}
const versusNote = (st: { versus?: { name: string; score: number } }) => st.versus
  ? `HEAD-TO-HEAD: this is the same board ${st.versus.name} played, dealt the same way; at the end the host hears who scored more. Don't say ${st.versus.name}'s score until the end.\n\n`
  : "";
/** The result line when a head-to-head board ends. */
function versusResult(top: [string, number], vs: { name: string; score: number }): string {
  const [me, mine] = top;
  const verdict = mine > vs.score ? `${me} wins by ${mine - vs.score}` : mine < vs.score ? `${vs.name} wins by ${vs.score - mine}` : "it's a tie";
  return `HEAD-TO-HEAD RESULT: ${vs.name} scored ${vs.score} on this same board; ${me} scored ${mine}: ${verdict}. Say it warmly.`;
}

// The answers the connect check accepts (site.ts CONNECT_ISSUES holds the wording and the tips).
const FEEDBACK_ASSISTANTS = new Set(["claude", "gemini", "chatgpt", "other"]);
// Connected assistants follow the account (migration 0023, Ben 2026-10-22). A missing table reads as none.
async function assistantsOf(db: D1Database | undefined, userId: string): Promise<string[]> {
  if (!db) return [];
  try { return ((await db.prepare("SELECT assistant FROM user_assistants WHERE user_id = ? AND removed = 0 ORDER BY at").bind(userId).all<{ assistant: string }>()).results ?? []).map((r) => r.assistant); } catch { return []; }
}
async function noteAssistants(db: D1Database | undefined, userId: string, ids: string[], removed = false): Promise<void> {
  const ok = ids.filter((x) => FEEDBACK_ASSISTANTS.has(x)).slice(0, 4);
  if (!db || !ok.length) return;
  const now = Date.now();
  try {
    await db.batch(ok.map((a) => db.prepare("INSERT INTO user_assistants (user_id, assistant, at, removed) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, assistant) DO UPDATE SET at = excluded.at, removed = excluded.removed").bind(userId, a, now, removed ? 1 : 0)));
  } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
}
/** The account connector in use: the assistant calling it is connected for that person (one write an hour at most). */
async function seenAssistant(db: D1Database | undefined, userId: string, client: string | null): Promise<void> {
  const a = ({ Claude: "claude", Gemini: "gemini", ChatGPT: "chatgpt" } as Record<string, string>)[assistantOf(client)];
  if (!db || !a) return;
  try {
    await db.prepare("INSERT INTO user_assistants (user_id, assistant, at, removed) VALUES (?, ?, ?, 0) ON CONFLICT(user_id, assistant) DO UPDATE SET at = excluded.at, removed = 0 WHERE user_assistants.removed = 1 OR user_assistants.at < excluded.at - 3600000").bind(userId, a, Date.now()).run();
  } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
}
/** POST /api/assistants {add?: [], remove?: []}: a signed-in visitor's badges, kept on the account. */
async function assistantsApi(request: Request, env: Env, url: URL): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return apiJson({ error: "forbidden" }, 403);
  const user = signInConfigured(env) ? await currentUser(request, env) : null;
  if (!user) return apiJson({ error: "sign in first" }, 401);
  let body: { add?: unknown; remove?: unknown };
  try { body = await request.json(); } catch { return apiJson({ error: "send JSON" }, 400); }
  const list = (v: unknown) => (Array.isArray(v) ? v : []).map(String);
  await noteAssistants(env.DB, user.id, list(body.add));
  await noteAssistants(env.DB, user.id, list(body.remove), true);
  return apiJson({ ok: true, assistants: await assistantsOf(env.DB, user.id) });
}
const FEEDBACK_ISSUES = /^[a-z][a-z-]{1,30}$/;
async function connectFeedback(request: Request, env: Env, url: URL): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return apiJson({ error: "forbidden" }, 403);
  let body: { assistant?: unknown; outcome?: unknown; issue?: unknown; note?: unknown; page?: unknown };
  try { body = await request.json(); } catch { return apiJson({ error: "send JSON" }, 400); }
  const assistant = String(body.assistant ?? ""), outcome = String(body.outcome ?? "");
  if (!FEEDBACK_ASSISTANTS.has(assistant) || !["yes", "no"].includes(outcome)) return apiJson({ error: "bad request" }, 400);
  if (outcome === "yes" && signInConfigured(env)) { const u = await currentUser(request, env); if (u) await noteAssistants(env.DB, u.id, [assistant]); }
  const issue = typeof body.issue === "string" && FEEDBACK_ISSUES.test(body.issue) ? body.issue : null;
  const note = typeof body.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, 800) || null : null;
  const pageName = typeof body.page === "string" ? body.page.replace(/[^a-z0-9/#-]/gi, "").slice(0, 40) || null : null;
  if (!env.DB) return apiJson({ ok: true });
  try {
    const ip = await hashIp(request.headers.get("cf-connecting-ip") ?? "unknown", env as unknown as SubEnv);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM connect_feedback WHERE ip_hash = ? AND at > ?").bind(ip, Date.now() - 86_400_000).first<{ n: number }>();
    if ((n?.n ?? 0) >= 10) return apiJson({ ok: true, capped: true });
    await env.DB.prepare("INSERT INTO connect_feedback (at, assistant, outcome, issue, note, page, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(Date.now(), assistant, outcome, outcome === "no" ? issue : null, outcome === "no" ? note : null, pageName, ip).run();
  } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); }
  return apiJson({ ok: true });
}

/** The alternatives upheld challenges have taught this board: clue id to names. A missing table reads as none. */
async function learnedAliases(db: D1Database, key: string): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  try {
    const { results } = await db.prepare("SELECT clue_id, alias FROM clue_aliases WHERE story = ?").bind(key).all<{ clue_id: string; alias: string }>();
    for (const r of results ?? []) m.set(r.clue_id, [...(m.get(r.clue_id) ?? []), r.alias]);
  } catch { /* the table arrives with migration 0014 */ }
  return m;
}
const seenKey = (slug: string, st: { team?: string } | null | undefined) => (slug === TEAM_TRIVIA && st?.team ? `${TEAM_TRIVIA}/${st.team}` : slug);
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
  // A player's public page: badges and game stats only, when they've turned it on (src/profile.ts).
  const pub = /^\/p\/([a-z0-9-]{3,20})\/?$/.exec(p);
  if (pub && request.method === "GET") {
    const prof = await publicProfile(env.DB, pub[1]);
    if (!prof) return new Response("No such page.\n", { status: 404, headers: { "content-type": "text/plain", "x-robots-tag": "noindex" } });
    return withAccountLink(request, env, new Response(publicProfilePage(prof, siteOrigin(url)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }));
  }
  if (!p.startsWith("/account")) return null;
  const origin = siteOrigin(url);
  // Forms post from this site only (the session cookie would ride along on a cross-site post).
  const sameOrigin = (request.headers.get("origin") ?? origin) === origin;
  if (p === "/account/signout" && request.method === "POST" && sameOrigin) return signOut(request, env);
  const user = await currentUser(request, env);
  if (p === "/account/profile" && request.method === "POST" && sameOrigin && user && env.DB) {
    let notice = "saved";
    try {
      const form = await request.formData();
      const raw = String(form.get("handle") ?? "").trim();
      const checked = raw ? checkHandle(raw, DENYLIST) : { handle: null as string | null };
      if ("error" in checked) notice = checked.error;
      else notice = await saveProfile(env.DB, user.id, checked.handle, form.get("public") === "1");
    } catch (e) { log("db_error", { message: String(e).slice(0, 200) }); notice = "error"; }
    return Response.redirect(new URL(`/account?profile=${notice}#profile`, url).toString(), 303);
  }
  if (p === "/account/delete" && request.method === "POST" && sameOrigin && user) {
    try { await deleteAccount(env, user.id); } catch (e) {
      log("db_error", { message: String(e).slice(0, 200) });
      return new Response("Your account couldn't be deleted just now. Please try again in a minute.\n", { status: 503, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
    }
    // The account connector's grants go too, so an assistant connected with this account stops
    // working at once instead of writing history for an account that no longer exists.
    if (env.ACCOUNT_HOST && env.OAUTH_KV) {
      try {
        const api = accountApi(env.ACCOUNT_HOST, env);
        let cursor: string | undefined;
        for (let page = 0; page < 20; page++) {
          const list = await api.listUserGrants(user.id, { cursor });
          for (const g of list.items) await api.revokeGrant(g.id, user.id);
          cursor = list.cursor;
          if (!cursor) break;
        }
      } catch (e) { log("oauth_error", { message: String(e).slice(0, 200) }); }
    }
    return signOut(request, env);
  }
  if (p !== "/account" || request.method !== "GET") return null;
  // Signed out: straight to Google sign-in, back here after. The page explaining accounts is /account?why=1.
  if (!user && signInConfigured(env) && !url.searchParams.has("why")) return Response.redirect(`${origin}/auth/google/start?next=/account`, 302);
  const history = user ? await historyOf(env.DB, user.id) : [];
  const profile = user ? await profileOf(env.DB, user.id) : null;
  const resp = new Response(accountPage({ profile, notice: url.searchParams.get("profile"), user, history, configured: signInConfigured(env), accountMcp: env.ACCOUNT_HOST ? `https://${env.ACCOUNT_HOST}/mcp` : null }, origin), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  return withAccountLink(request, env, resp);
}

/** Puts "Sign in" or the person's first name in the page header (site pages leave a marker for it). */
async function withAccountLink(request: Request, env: Env, res: Response): Promise<Response> {
  if (!(res.headers.get("content-type") ?? "").startsWith("text/html")) return res;
  const body = await res.text();
  if (!body.includes("<!--ACCOUNT-->")) return new Response(body, res);
  const user = signInConfigured(env) ? await currentUser(request, env) : null;
  const label = user ? esc((user.name ?? "").split(" ")[0] || "Account") : "Sign in";
  // Signed out, "Sign in" goes straight to Google and back to this page (Ben, 2026-10-22).
  const here = new URL(request.url);
  const link = signInConfigured(env) ? `<a class="acct" href="${user ? "/account" : `/auth/google/start?next=${encodeURIComponent(here.pathname + here.search)}`}">${label}</a>` : "";
  const headers = new Headers(res.headers);
  if (user) headers.set("cache-control", "private, no-store");
  // The Connect page's account note: the Claude button itself now adds the account connector, so a
  // short pointer to what signing in keeps is enough.
  const connectNote = signInConfigured(env) ? `<p class="muted">Signing in keeps your saved progress: what you've played, trivia you've heard, and your campaigns. <a href="/account?why=1">About accounts</a></p>` : "";
  // The connect boxes show only the account address to a signed-in visitor (site.ts addressBlock).
  return new Response(body.replace("<!--ACCOUNT-->", link).replace("<!--ACCOUNT-CONNECT-->", connectNote).replace("<body>", `<body data-signed="${user ? "in" : "out"}"${user ? ` data-assistants="${esc((await assistantsOf(env.DB, user.id)).join(","))}"` : ""}>`), { status: res.status, headers });
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 301 for pages; 308 (method-preserving) for anything else, so a redirected POST stays a POST (S15).
const redirect = (request: Request, to: string) => Response.redirect(to, request.method === "GET" || request.method === "HEAD" ? 301 : 308);

// The site and the open connector (plotspeaks.com).
async function mainFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Plain http reaches the custom domain too, and the site builds its "Connect to Claude" link from
    // the request's origin; Claude refuses an http connector URL (Ben, 2026-10-16). Send everyone to https.
    // Not on a local run: wrangler dev gives the request the first route's hostname, so the URL says
    // dev.plotspeaks.com while the Host header still says 127.0.0.1 (2026-10-21: a clone of the public
    // repository redirected every local request to itself, forever).
    // wrangler dev rewrites the Host header as well; what it doesn't do is add cf-connecting-ip, which
    // Cloudflare's edge puts on every request. No such header means a local run.
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(request.headers.get("host") ?? "") || request.headers.get("cf-connecting-ip") === null;
    if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && !localHost) {
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
    // "Did it connect?" (site.ts CHECK_JS): a yes or a no with the problem picked and an optional note.
    if (url.pathname === "/api/connect-feedback" && request.method === "POST") return connectFeedback(request, env, url);
    if (url.pathname === "/api/assistants" && request.method === "POST") return assistantsApi(request, env, url);
    const watchM = /^\/api\/play\/([a-z%20+-]{3,60})$/i.exec(url.pathname);
    if (watchM && request.method === "GET") return watchApi(env, watchM[1]);
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
      const listed = PUBLIC_STORIES.filter((p) => inSeason(STORIES.find((s) => s.slug === p.slug) ?? {}));
      const site = await handleSite(request, approved.length ? [...listed, ...approved.filter((a) => !BUILTINS.slugs.has(a.slug))] : listed, env.DB, PREVIEW_STORIES);
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
    if (userId && request.method === "POST") ctx.waitUntil(seenAssistant(env.DB, userId, client));
    const res = await createMcpHandler(() => createServer({ db: env.DB, tester, client, chatgpt, env, ip, userId }), { route: "/mcp" })(request, env, ctx);
    if (request.method === "POST") ctx.waitUntil(countMcp(env.DB, msgs, res.clone(), tester));
    return res;
}

// The account connector's host: OAuth (discovery, dynamic client registration, tokens) around the
// same MCP endpoint. Plays made through it belong to the signed-in person.
// One provider per account host (account.plotspeaks.com on prod, account-dev on dev), built on first use.
const accountProviders = new Map<string, { provider: OAuthProvider<Env>; options: OAuthProviderOptions<Env> }>();
const accountFor = (host: string) => {
  let p = accountProviders.get(host);
  if (!p) { const options = accountOptions(`https://${host}`); p = { provider: new OAuthProvider<Env>(options), options }; accountProviders.set(host, p); }
  return p;
};
const accountProviderFor = (host: string) => accountFor(host).provider;
const accountOptions = (origin: string): OAuthProviderOptions<Env> => ({
  resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ["header"], resource_name: "Plot Speaks (with your account)" },
  apiRoute: "/mcp",
  apiHandler: {
    fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
      const userId = String((ctx as unknown as { props?: { userId?: string } }).props?.userId ?? "") || null;
      // A token for an account that has since been deleted: ask the client to sign in again rather
      // than playing on (and writing history) for someone who no longer exists.
      if (!userId || !(await userById(env, userId))) {
        return new Response("This sign-in is no longer valid. Remove the Plot Speaks connector and add it again.\n", {
          status: 401,
          headers: { "content-type": "text/plain", "www-authenticate": `Bearer realm="OAuth", error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` },
        });
      }
      return serveMcp(request, env, ctx, userId);
    },
  },
  defaultHandler: {
    fetch: (request: Request, env: Env) => {
      // The directory and Claude show the favicon from the server's own host, so the account host
      // serves the same icons as plotspeaks.com.
      const p = new URL(request.url).pathname;
      if (env.ASSETS && /^\/(favicon\.ico|favicon-32\.png|icon-(192|512)\.png|apple-touch-icon\.png|plot-speaks-logo\.png|plot-speaks-mark\.png|site\.webmanifest)$/.test(p)) return env.ASSETS.fetch(request);
      return accountSite(request, env as unknown as AccountEnv);
    },
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["play"],
  accessTokenTTL: 3600,
  refreshTokenTTL: 180 * 86400,
});
/** The OAuth helpers (grants, tokens) for an account host, usable from the site host too. */
const accountApi = (host: string, env: Env) => getOAuthApi(accountFor(host).options, env);

function serverAlert(env: Env, request: Request, what: string): Promise<boolean> {
  const route = routeOf(new URL(request.url).pathname);
  return alertOnce(env, `5xx:${route}`, { title: "Plot Speaks: server error", message: `${request.method} ${route} failed (${what}). The worker logs have the details.` });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const host = new URL(request.url).hostname;
    if (env.ACCOUNT_HOST && host === env.ACCOUNT_HOST) {
      // Fails closed: without its token store the account host must never fall through to the open
      // site and serve its /mcp anonymously.
      if (!env.OAUTH_KV) return new Response("The account connector is unavailable right now.\n", { status: 503, headers: { "content-type": "text/plain" } });
      return accountProviderFor(host).fetch(request, env, ctx);
    }
    // A request that threw, or a server error answered: one alert per area of the site per hour, naming
    // only the first path segment (/mcp, /admin), never the full address, a player's words or an id.
    let res: Response;
    try {
      res = await mainFetch(request, env, ctx);
    } catch (e) {
      log("unhandled_error", { route: routeOf(new URL(request.url).pathname), message: String(e).slice(0, 200) });
      ctx.waitUntil(serverAlert(env, request, (e as Error)?.name || "Error"));
      return new Response("Something went wrong on our side. Please try again in a moment.\n", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (res.status >= 500) ctx.waitUntil(serverAlert(env, request, `HTTP ${res.status}`));
    return res;
  },

  // Daily Cron Trigger (wrangler.jsonc "triggers"): 90-day log retention, see src/retention.ts.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runRetention(env.DB)
        .then(async (counts) => { log("retention", counts); await bump(env.DB, [["job", "retention"]]); })
        .catch(async (e) => {
          log("retention_error", { message: String(e).slice(0, 200) });
          await bump(env.DB, [["job", "retention_error"]]);
          await alertOnce(env, "retention", { title: "Plot Speaks: nightly job failed", message: `The 90-day retention job stopped with ${(e as Error)?.name || "an error"}; old logs weren't removed tonight. The worker logs have the details.` });
        }),
    );
    // Who follows the GitHub organisation or has starred, watched or forked the repo (src/github.ts).
    ctx.waitUntil(runGithubWatch(env.DB).then((r) => log("github_watch", r)).catch(async (e) => {
      log("github_watch_error", { message: String(e).slice(0, 200) });
      await alertOnce(env, "github-watch", { title: "Plot Speaks: GitHub watch failed", message: `Tonight's check of GitHub followers and stars stopped with ${(e as Error)?.name || "an error"}.`, level: "info" });
    }));
  },
} satisfies ExportedHandler<Env>;
