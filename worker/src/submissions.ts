// Story submissions and the review queue (Phase 2, M5). No sign-in, no new accounts.
//
// Exported for the catalog site (site.ts may import these; both read D1 only):
//
//   listApprovedSubmissions(db: D1Database | undefined): Promise<{ slug: string; story: string }[]>
//     Approved submissions in the same { slug, story } shape as the built-in PublicStory list:
//     the public story.md text only, never secrets_md, contact or moderation data. Returns [] when
//     db is missing, the table doesn't exist yet, or the query fails. Covers for these slugs are
//     served by the Worker at /covers/<slug>.jpg, the same path as the built-in covers.
//
// Used by index.ts:
//   submitStory(env, caller, builtins, args)  the submit_story tool (new story, or a replacement with replaces_id + claim_code)
//   withdrawSubmission(env, args)         the withdraw_submission tool (id + claim code)
//   loadApprovedStories(db)               approved submissions in the play-tool Story shape
//   handleAdmin(request, env, builtins)   /admin/* (key-gated; 404 when no admin key is set)
//   serveSubmissionCover(db, slug)        /covers/<slug>.jpg for an approved submission
//
// Flow of submit_story: size caps (zod, in index.ts) -> format lint (refuse on any ERROR) ->
// daily caps (per IP for direct callers; site-wide for everyone, connector traffic included) -> Llama Guard 3 on story_md and secrets_md -> cover -> D1 row
// with status 'pending'. Nothing is public until Ben approves it at /admin/submissions.
import { checkSubmitted, DENYLIST } from "./studio";
import { generateCover } from "./covers";
import { parseEndings, extractCue, parseFullReveal } from "../../tools/playtest/lib.mjs";
import { connectorStory, connectorNotes } from "../../tools/worker-data/connector.mjs";
import { parseFrontMatter, checkDenylist, kindOf, isFamily } from "../../tools/check-story/rules.mjs";
import { compileBranches } from "../../tools/check-story/branches.mjs";
import type { BranchGraph } from "./branching";
import type { TriviaBoard } from "./games";
import { compileTrivia } from "../../tools/check-story/trivia.mjs";
import { adminStats } from "./stats";

export const GUARD_MODEL = "@cf/meta/llama-guard-3-8b";
export const PER_IP_DAILY = 3;
// Site-wide submissions a day (env SUBMIT_DAILY_CAP overrides). Connector traffic arrives from the
// assistant company's servers, so it is held only by this cap, never by the per-IP one (S6).
export const SITE_DAILY_DEFAULT = 20;
const DAY = 24 * 60 * 60 * 1000;

type Ai = { run: (model: string, input: Record<string, unknown>) => Promise<any> };
export type SubEnv = {
  ENVIRONMENT?: string; DEV_ACCESS_KEY?: string; ADMIN_KEY?: string; IP_SALT?: string; SUBMIT_DAILY_CAP?: string;
  DB?: D1Database; AI?: Ai;
};
export type Ending = { name: string; verdict: string; text: string };
type Cue = { read_aloud: string; narrator_only: string | null };
export type FullReveal = { read_aloud: string; afterward: string | null };
export type PlayStory = {
  slug: string; title: string; genre: string; tone: string; kind: string; audience: "general" | "family"; players: string; duration_minutes: number | null;
  story: string; story_connector: string[]; endings: Ending[]; cues: Record<string, Cue>;
  listen_for: string | null; listen_for_raw: string | null; full_reveal: FullReveal | null;
  branches: BranchGraph | null;
  trivia?: TriviaBoard | null;
  picks?: string[];
  // In stories/catalog.json "preview": served when named exactly, never listed (Ben's voice check).
  preview?: boolean;
};
/** kind and audience from a story's front matter (the same rules as the lint and the build). */
export function kindFields(story: string, genre: string): { kind: string; audience: "general" | "family" } {
  const fm = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(story) || [, ""])[1];
  const f = (k: string) => ((new RegExp(`^\\s*${k}:\\s*["']?([A-Za-z-]+)`, "m").exec(fm) || [, ""])[1]).toLowerCase();
  const md = { kind: f("kind"), audience: f("audience"), genre };
  return { kind: kindOf(md) as string, audience: isFamily(md) ? "family" : "general" };
}
/** metadata.tone from a story's front matter (classic | dark | cozy), lower-cased; "" when absent. */
export function toneOf(story: string): string {
  const fm = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(story) || [, ""])[1];
  return ((/^\s*tone:\s*["']?([A-Za-z-]+)/m.exec(fm) || [, ""])[1]).toLowerCase();
}
/** Who is submitting: the connecting IP, and whether it is an assistant's connector (whose IP is the company's, not the person's). */
export type Caller = { ip: string; connector: string | null };
export type Builtins = { slugs: Set<string>; storyFor: (slug: string) => string | null };

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }));
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const nl = (s: string) => s.replace(/\r\n?/g, "\n");

// ------------------------------------------------------------------ moderation (Llama Guard 3)

// Llama Guard 3's hazard categories, in plain words for the refusal message.
const CATEGORY: Record<string, string> = {
  S1: "violent crimes", S2: "non-violent crimes", S3: "sex-related crimes", S4: "child sexual exploitation",
  S5: "defamation of real people", S6: "specialized advice (medical, legal or financial)", S7: "private information about real people",
  S8: "intellectual property", S9: "weapons of mass harm", S10: "hate", S11: "suicide or self-harm",
  S12: "sexual content", S13: "elections", S14: "code abuse",
};
// Murder mysteries and adventures are about crimes: a verdict of only S1/S2 is expected for crime
// fiction (docs/PHASE-2-PLAN.md: "thresholds must allow fictional violence"), so those two are
// recorded for the reviewer and do not refuse. Every other category refuses.
const FICTION_TOLERATED = new Set(["S1", "S2"]);

type Verdict = { safe: boolean; categories: string[]; refused: boolean; tolerated: string[]; chunks?: number };

// Llama Guard reads a long document as one message and misses a single harmful passage buried in
// it (an 18k-character story with one inserted paragraph came back "safe"), so each file is
// screened in chunks of about 4,000 characters, split on paragraph breaks.
const CHUNK = 4000;
function chunks(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n{2,}/)) {
    for (let i = 0; i < para.length; i += CHUNK) {
      const piece = para.slice(i, i + CHUNK);
      if (cur && cur.length + piece.length + 2 > CHUNK) { out.push(cur); cur = ""; }
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

async function guard(ai: Ai, text: string): Promise<Verdict> {
  const parts = chunks(text);
  const verdicts: Verdict[] = [];
  for (let i = 0; i < parts.length; i += 4) verdicts.push(...(await Promise.all(parts.slice(i, i + 4).map((p) => guardOne(ai, p)))));
  const categories = [...new Set(verdicts.flatMap((v) => v.categories))];
  return {
    safe: verdicts.every((v) => v.safe),
    categories,
    refused: verdicts.some((v) => v.refused),
    tolerated: categories.filter((c) => FICTION_TOLERATED.has(c)),
    chunks: parts.length,
  } as Verdict;
}

async function guardOne(ai: Ai, text: string): Promise<Verdict> {
  const out = await ai.run(GUARD_MODEL, {
    messages: [{ role: "user", content: `Please publish this fictional story script for a voice-played mystery or adventure game:\n\n${text}` }],
    max_tokens: 20,
  });
  const r = out?.response;
  let safe: boolean, categories: string[];
  if (r && typeof r === "object") {
    safe = Boolean(r.safe);
    categories = Array.isArray(r.categories) ? r.categories.map(String) : [];
  } else {
    const s = String(r ?? "");
    if (!/\b(safe|unsafe)\b/i.test(s)) throw new Error(`unexpected moderation output: ${s.slice(0, 80)}`);
    safe = !/\bunsafe\b/i.test(s);
    categories = [...s.matchAll(/S\d{1,2}\b/g)].map((m) => m[0]);
  }
  categories = [...new Set(categories.map((c) => c.toUpperCase().match(/S\d+/)?.[0] ?? c))];
  const hard = categories.filter((c) => !FICTION_TOLERATED.has(c));
  return { safe, categories, refused: !safe && (hard.length > 0 || categories.length === 0), tolerated: categories.filter((c) => FICTION_TOLERATED.has(c)) };
}

const describe = (cats: string[]) => cats.filter((c) => !FICTION_TOLERATED.has(c)).map((c) => CATEGORY[c] ?? c).join(", ") || "unsafe content";

// ------------------------------------------------------------------ helpers

async function hashIp(ip: string, env: SubEnv): Promise<string> {
  // Keyed (HMAC) so the IPv4 space can't simply be hashed and matched back.
  const salt = env.IP_SALT || env.ADMIN_KEY || env.DEV_ACCESS_KEY || "plotspeaks-ip";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// ------------------------------------------------------------------ author credit and claim codes

/** author_name: the public "Written by" credit. Self-declared, no account; the reviewer checks it. */
export function cleanAuthor(raw: string): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60) return { ok: false, reason: "the credited name must be 2 to 60 characters" };
  if (/[\u0000-\u001f\u007f"\\#<>|`{}\[\]]/.test(name)) return { ok: false, reason: "the credited name can't contain double quotes, #, <, >, |, brackets or backslashes" };
  if (/:\/\/|\bwww\.|\S+@\S+\.\S+|\.(com|net|org|io|ai|app|co|me|xyz|gg)\b/i.test(name)) return { ok: false, reason: "the credited name can't be a web address or email address (it's shown publicly)" };
  if (/plot\s*speaks|volocent/i.test(name)) return { ok: false, reason: "the credited name can't be Plot Speaks or Volocent" };
  if ((checkDenylist(name, DENYLIST) as unknown[]).length) return { ok: false, reason: "the credited name matches a protected character or brand name" };
  return { ok: true, name };
}

/** Puts the credited name into story.md's metadata.author (replacing the line, or adding one). */
export function withAuthor(storyMd: string, author: string | null | undefined): string {
  if (!author) return storyMd;
  const s = nl(storyMd);
  const fm = /^---\n([\s\S]*?)\n---(\n|$)/.exec(s);
  if (!fm) return storyMd;
  const line = `  author: "${author}"`;
  let block = fm[1];
  if (/^\s+author:.*$/m.test(block)) block = block.replace(/^\s+author:.*$/m, () => line);
  else if (/^metadata:\s*$/m.test(block)) block = block.replace(/^metadata:\s*$/m, (m) => `${m}\n${line}`);
  else return storyMd;
  return `---\n${block}\n---${fm[2]}${s.slice(fm[0].length)}`;
}

// 12 characters from 31 that can't be confused when read aloud or copied (no 0/O, 1/I/L): about
// 59 bits, shown once as XXXX-XXXX-XXXX. Only a SHA-256 of id + code is stored.
const CLAIM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newClaimCode(): string {
  const out: string[] = [];
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && out.length < 12) out.push(CLAIM_ALPHABET[b % 31]); // 248 = 8 * 31: no modulo bias
    }
  }
  return `${out.slice(0, 4).join("")}-${out.slice(4, 8).join("")}-${out.slice(8).join("")}`;
}
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
export async function claimHash(id: string, code: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${id}:${normCode(code)}`)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

function meta(storyMd: string) {
  const fm = parseFrontMatter(storyMd) as { ok: boolean; name?: string; metadata?: Record<string, unknown>; data?: Record<string, unknown> };
  const m = (fm.ok && fm.metadata) || {};
  const raw = (/^---\n([\s\S]*?)\n---/.exec(nl(storyMd)) || [, ""])[1];
  const field = (k: string) => ((new RegExp(`^\\s*${k}:\\s*(.+)$`, "m").exec(raw) || [, ""])[1]).replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
  const title = String(m.title ?? field("title") ?? "").trim() || "Untitled";
  const name = field("name");
  return {
    title,
    slugWanted: slugify(name.replace(/^plotspeaks-/, "")) || slugify(title) || "story",
    genre: String(m.genre ?? field("genre") ?? ""),
    players: String(m.players ?? field("players") ?? ""),
    duration: Number(m.duration_minutes ?? field("duration_minutes")) || null,
  };
}

// Same extraction as tools/worker-data/build.mjs, so an approved submission plays exactly like a
// built-in story: check_accusation returns one ending line, get_cue one cue, and the connector
// text has no paste-play wrangler hand-offs (tools/worker-data/connector.mjs).
const notes = (t: string | null) => (t ? (connectorNotes(t) as { text: string }).text : t);
function playData(secrets: string) {
  const s = nl(secrets);
  const wranglerOnly = (id: string) => {
    const sec = new RegExp(`^##\\s+S${id}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im").exec(s);
    if (!sec) return null;
    const m = /\*\*Wrangler only[^*]*:\*\*\s*([\s\S]*?)(?=^\*\*[A-Z][^\n]*:\*\*|(?![\s\S]))/im.exec(sec[1]);
    return m ? m[1].trim() : null;
  };
  const cues: Record<string, Cue> = {};
  for (const m of s.matchAll(/^##\s+S(\d+[a-z]?)\b/gim)) {
    const c = extractCue(s, m[1]);
    if (c) cues[`S${m[1]}`.toUpperCase()] = { read_aloud: notes(c) as string, narrator_only: notes(wranglerOnly(m[1])) };
  }
  // The table may be the last section of the file, so "the next heading or the end" closes it.
  const listen = (/^#{2,3}\s+Listen for[^\n]*\n([\s\S]*?)(?=^#{2,3}\s|(?![\s\S]))/im.exec(s) || [, null])[1];
  const endings = (parseEndings(s) as Ending[]).map(({ name, verdict, text }) => ({ name, verdict, text }));
  return { endings, cues, listen_for: listen ? notes(listen.trim()) : null, listen_for_raw: listen ? listen.trim() : null, full_reveal: parseFullReveal(s) as FullReveal | null };
}

// ------------------------------------------------------------------ submit_story

export async function submitStory(
  env: SubEnv,
  caller: Caller,
  builtins: Builtins,
  args: { story_md: string; secrets_md?: string; contact?: string; author_name: string; replaces_id?: string; claim_code?: string },
): Promise<string> {
  const author = cleanAuthor(args.author_name ?? "");
  if (!author.ok) {
    log("submit_story", { outcome: "author" });
    return `Not submitted: ${author.reason}. Ask the writer what name to credit (a pen name is fine) and submit again.`;
  }
  const story = nl(args.story_md);
  const secrets = args.secrets_md ? nl(args.secrets_md) : undefined;
  const lint = checkSubmitted(story, secrets);
  if (lint.errors) {
    log("submit_story", { outcome: "lint", errors: lint.errors });
    return `Not submitted: the story has ${lint.errors} format error(s). Fix them and submit again (review_story shows the same list).\n\n${lint.report}`;
  }
  const db = env.DB, ai = env.AI;
  if (!db || !ai) return "Submissions are switched off on this server right now. Nothing was stored.";

  // A replacement: checked before screening, so a wrong code costs no Workers AI allowance.
  let replacing: { id: string; slug: string; status: string } | null = null;
  if (args.replaces_id || args.claim_code) {
    if (!args.replaces_id || !args.claim_code) return "Not submitted: to update a submission, send both replaces_id (the submission id) and claim_code. Nothing was stored.";
    const id = args.replaces_id.trim().toLowerCase();
    try {
      replacing = await db.prepare("SELECT id, slug, status FROM submissions WHERE id = ? AND claim_hash = ?").bind(id, await claimHash(id, args.claim_code)).first();
    } catch (e) {
      log("db_error", { where: "submit_replace", message: String(e) });
    }
    if (!replacing) {
      log("submit_story", { outcome: "replace_no_match" });
      return "Not submitted: no submission matches that id and claim code. Check both (the code looks like ABCD-EFGH-JKMN). Nothing was stored.";
    }
  }

  // Through a connector the IP is the assistant company's, shared by everyone using it, so it is
  // neither hashed nor capped; the row is marked with the assistant's name instead.
  const ipHash = caller.connector ? `connector:${caller.connector}` : await hashIp(caller.ip || "unknown", env);
  const since = Date.now() - DAY;
  const cap = Number(env.SUBMIT_DAILY_CAP) || SITE_DAILY_DEFAULT;
  try {
    const mine = caller.connector ? null : await db.prepare("SELECT COUNT(*) AS n FROM submission_attempts WHERE ip_hash = ? AND at > ?").bind(ipHash, since).first<{ n: number }>();
    if ((mine?.n ?? 0) >= PER_IP_DAILY) return `Not submitted: there's a limit of ${PER_IP_DAILY} submissions a day from one connection, and it has been reached. Please try again tomorrow.`;
    const all = await db.prepare("SELECT COUNT(*) AS n FROM submission_attempts WHERE at > ?").bind(since).first<{ n: number }>();
    if ((all?.n ?? 0) >= cap) return "Not submitted: Plot Speaks has taken all the submissions it can screen today. Please try again tomorrow.";
  } catch (e) {
    log("db_error", { where: "submit_caps", message: String(e) });
    return "Submissions aren't available right now (the review queue isn't set up on this server). Nothing was stored.";
  }

  const attempt = (outcome: string, id: string | null) =>
    db.prepare("INSERT INTO submission_attempts (ip_hash, at, outcome, submission_id) VALUES (?, ?, ?, ?)").bind(ipHash, Date.now(), outcome, id).run();

  // Moderation. Failing closed: if the screener can't run, nothing is stored.
  let mod: { story: Verdict; secrets: Verdict | null };
  try {
    // The credit line is public too, so it is screened with the story.
    mod = { story: await guard(ai, `Author credit (pen name): ${author.name}\n\n${story}`), secrets: secrets ? await guard(ai, secrets) : null };
  } catch (e) {
    log("submit_story", { outcome: "moderation_error", message: String(e).slice(0, 200) });
    await attempt("error", null).catch(() => {});
    return "Not submitted: the safety screener couldn't run just now (it may be over today's free allowance). Nothing was stored; please try again tomorrow.";
  }
  const refusedBy = [mod.story.refused ? "story" : null, mod.secrets?.refused ? "secrets" : null].filter(Boolean);
  if (refusedBy.length) {
    const cats = [...mod.story.categories, ...(mod.secrets?.categories ?? [])];
    log("submit_story", { outcome: "refused", categories: cats });
    await attempt("refused", null).catch(() => {});
    return `Not submitted: the automatic safety screener flagged the ${refusedBy.join(" and ")} text for ${describe(cats)}. ` +
      "Plot Speaks can't take stories with that content. Nothing was stored. If you think this is a mistake, change the passages that could read that way and submit again.";
  }

  const m = meta(story);
  // No cover here: the MCP tools never generate images (Anthropic directory acknowledgement,
  // 2026-10-16). The cover columns are written NULL and filled in when Ben approves the story on
  // the admin page; a replacement also clears the old cover so approval makes a fresh one.
  const lintSummary = JSON.stringify({ errors: lint.errors, warnings: lint.warnings, summary: lint.report.split("\n")[0], report: lint.report.slice(0, 4000) });
  const moderation = JSON.stringify({ model: GUARD_MODEL, at: Date.now(), story: mod.story, secrets: mod.secrets });
  const contact = args.contact?.trim() || null;
  const common = [
    secrets ? "The secrets file is kept private on the server: players only ever get what the story or game hands out, one piece at a time."
      : ["game", "campaign"].includes(kindFields(story, m.genre).kind) ? "" : "No secrets file was included; a mystery, a choose-your-path story or a trivia board needs one before it can be approved.",
    lint.warnings ? `The format check passed with ${lint.warnings} warning(s); the reviewer will see them.` : "The format check passed with no warnings.",
    contact ? "Your contact details are seen only by the reviewer." : "",
  ];

  if (replacing) {
    // Same id, slug and claim code; back to pending until a person reviews the new version.
    await db.prepare(
      `UPDATE submissions SET status = 'pending', reviewed_at = NULL, title = ?, genre = ?, players = ?, duration_minutes = ?, story_md = ?, secrets_md = ?,
         contact = ?, moderation = ?, lint = ?, cover = ?, cover_type = ?, cover_prompt = ?, author_name = ? WHERE id = ?`,
    ).bind(m.title, m.genre, m.players, m.duration, story, secrets ?? null, contact, moderation, lintSummary,
      null, null, null, author.name, replacing.id).run();
    await attempt("stored", replacing.id);
    log("submit_story", { outcome: "replaced", id: replacing.id, was: replacing.status, story_chars: story.length, warnings: lint.warnings });
    return [
      `Thank you! The new version of "${m.title}" replaced submission ${replacing.id}, credited to ${author.name}.`,
      replacing.status === "approved"
        ? "The old version was published; the story is now off the catalog until a person reviews the new version."
        : "A person reviews every submission before it's published, so it is not public yet.",
      "Your claim code stays the same.",
      ...common,
    ].filter(Boolean).join("\n");
  }

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  let slug = m.slugWanted;
  const taken = async (s: string) => builtins.slugs.has(s) || Boolean(await db.prepare("SELECT 1 FROM submissions WHERE slug = ?").bind(s).first());
  if (await taken(slug)) slug = `${slug.slice(0, 40)}-${id.slice(0, 6)}`;
  const code = newClaimCode();
  const devMarker = env.ENVIRONMENT === "dev" && slug.startsWith("smoke-test") ? 1 : 0;
  await db.prepare(
    `INSERT INTO submissions (id, created_at, status, title, slug, genre, players, duration_minutes, story_md, secrets_md, contact,
       moderation, lint, cover, cover_type, cover_prompt, ip_hash, dev_marker, author_name, claim_hash)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, Date.now(), m.title, slug, m.genre, m.players, m.duration, story, secrets ?? null, contact,
    moderation, lintSummary, null, null, null, ipHash, devMarker,
    author.name, await claimHash(id, code)).run();
  await attempt("stored", id);
  log("submit_story", { outcome: "stored", id, story_chars: story.length, secrets_chars: secrets?.length ?? 0, warnings: lint.warnings });

  return [
    `Thank you! "${m.title}" was received, credited to ${author.name}. Submission id: ${id}.`,
    `Claim code: ${code}`,
    "Please keep the claim code somewhere safe: it is shown only this once. There are no accounts, so the submission id and this code are how you withdraw the story or send a new version later. Nobody else can do either without the code, and Plot Speaks can't look it up for you.",
    "A person reviews every submission before it's published, so it is not public yet and can't be played or found in the catalog until it's approved. The reviewer also checks the credited name.",
    ...common,
  ].filter(Boolean).join("\n");
}

// ------------------------------------------------------------------ withdraw_submission

export async function withdrawSubmission(env: SubEnv, args: { id: string; claim_code: string }): Promise<string> {
  const db = env.DB;
  if (!db) return "Withdrawals aren't available on this server right now. Nothing was changed.";
  const id = args.id.trim().toLowerCase();
  let row: { id: string; title: string; status: string; dev_marker: number } | null = null;
  try {
    row = await db.prepare("SELECT id, title, status, dev_marker FROM submissions WHERE id = ? AND claim_hash = ?").bind(id, await claimHash(id, args.claim_code)).first();
  } catch (e) {
    log("db_error", { where: "withdraw", message: String(e) });
    return "Withdrawals aren't available on this server right now. Nothing was changed.";
  }
  // One answer for an unknown id and a wrong code, so ids can't be probed.
  if (!row) {
    log("withdraw_submission", { outcome: "no_match" });
    return "Not withdrawn: no submission matches that id and claim code. Check both (the code looks like ABCD-EFGH-JKMN). Nothing was changed.";
  }
  try {
    await db.batch([
      db.prepare("DELETE FROM submissions WHERE id = ?").bind(id),
      // The attempt rows still count toward the daily caps (withdrawing must not reset them), so they
      // only lose the link; smoke-test rows on dev are removed outright.
      row.dev_marker
        ? db.prepare("DELETE FROM submission_attempts WHERE submission_id = ?").bind(id)
        : db.prepare("UPDATE submission_attempts SET submission_id = NULL WHERE submission_id = ?").bind(id),
    ]);
  } catch (e) {
    // Caught here so the database's own error text never becomes the tool's reply.
    log("db_error", { where: "withdraw_delete", message: String(e).slice(0, 200) });
    return "Withdrawals aren't available on this server right now. Nothing was changed; try again in a minute.";
  }
  log("withdraw_submission", { outcome: "deleted", id, was: row.status });
  return `Withdrawn: "${row.title}" (submission ${id}) has been deleted from Plot Speaks${row.status === "approved" ? " and is no longer in the catalog" : ""}. Its claim code no longer works.`;
}

// ------------------------------------------------------------------ approved submissions

type Row = { slug: string; title: string; genre: string | null; players: string | null; duration_minutes: number | null; story_md: string; secrets_md: string | null; author_name: string | null };

async function approvedRows(db: D1Database | undefined): Promise<Row[]> {
  if (!db) return [];
  try {
    const { results } = await db.prepare(
      "SELECT slug, title, genre, players, duration_minutes, story_md, secrets_md, author_name FROM submissions WHERE status = 'approved' ORDER BY reviewed_at, created_at",
    ).all<Row>();
    // The credited name becomes metadata.author in every copy served (players and the site).
    return (results ?? []).map((r) => ({ ...r, story_md: withAuthor(r.story_md, r.author_name) }));
  } catch (e) {
    log("db_error", { where: "approved_submissions", message: String(e) });
    return [];
  }
}

export async function loadApprovedStories(db: D1Database | undefined): Promise<PlayStory[]> {
  return (await approvedRows(db)).map((r) => {
    const kf = kindFields(r.story_md, r.genre ?? "");
    return {
      slug: r.slug, title: r.title, genre: r.genre ?? "", tone: toneOf(r.story_md), ...kf, players: r.players ?? "", duration_minutes: r.duration_minutes,
      story: r.story_md, story_connector: (connectorStory(r.story_md) as { parts: string[] }).parts, ...playData(r.secrets_md ?? ""),
      branches: kf.kind === "branching" ? (compileBranches(r.secrets_md ?? "") as BranchGraph | null) : null,
      trivia: kf.kind === "trivia" ? (compileTrivia(r.secrets_md ?? "") as TriviaBoard | null) : null,
      // A game's hidden picks, one handed to the narrator per play (same section name as the build reads).
      picks: kf.kind === "game" ? [...((/^##\s+Picks\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(r.secrets_md ?? "") || [, ""])[1] ?? "").matchAll(/^\s*[-*]\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 500) : [],
    };
  });
}

export async function listApprovedSubmissions(db: D1Database | undefined): Promise<{ slug: string; story: string }[]> {
  return (await approvedRows(db)).map((r) => ({ slug: r.slug, story: r.story_md }));
}

export async function serveSubmissionCover(db: D1Database | undefined, slug: string): Promise<Response | null> {
  if (!db) return null;
  try {
    const row = await db.prepare("SELECT cover, cover_type FROM submissions WHERE slug = ? AND status = 'approved' AND cover IS NOT NULL").bind(slug).first<{ cover: ArrayBuffer | number[]; cover_type: string }>();
    if (!row) return null;
    return new Response(new Uint8Array(row.cover as ArrayBuffer), { headers: { "content-type": row.cover_type || "image/jpeg", "cache-control": "public, max-age=3600" } });
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ admin (key-gated)

/** Constant-time comparison, so a key can't be guessed from response timing (used by index.ts too). */
export function sameKey(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** ADMIN_KEY (a secret); in dev, DEV_ACCESS_KEY from .dev.vars also works. None set -> /admin/* is 404. */
function adminKeys(env: SubEnv): string[] {
  const keys: string[] = [];
  if (env.ADMIN_KEY) keys.push(env.ADMIN_KEY);
  if (env.ENVIRONMENT === "dev" && env.DEV_ACCESS_KEY) keys.push(env.DEV_ACCESS_KEY);
  return keys;
}

function presentedKey(request: Request): string {
  const h = request.headers.get("x-admin-key");
  if (h) return h.trim();
  const auth = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) return bearer[1].trim();
  const basic = /^Basic\s+(.+)$/i.exec(auth);
  if (basic) {
    try { const dec = atob(basic[1].trim()); return dec.slice(dec.indexOf(":") + 1); } catch { return ""; }
  }
  return "";
}

const notFound = () => new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain" } });
const forbidden = () => new Response("Forbidden\n", { status: 403, headers: { "content-type": "text/plain" } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export async function handleAdmin(request: Request, env: SubEnv, builtins: Builtins): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return null;
  const keys = adminKeys(env);
  if (!keys.length) return notFound();
  const given = presentedKey(request);
  const authed = Boolean(given) && keys.some((k) => sameKey(given, k));
  // A browser can't add headers, so /admin/login asks for HTTP Basic credentials (any user name,
  // the key as password); the browser then sends them with every /admin/ request.
  if (url.pathname === "/admin" || url.pathname === "/admin/login") {
    if (!authed) return new Response("Sign in with any user name and the admin key as the password.\n", { status: 401, headers: { "www-authenticate": 'Basic realm="Plot Speaks admin", charset="UTF-8"', "content-type": "text/plain" } });
    return Response.redirect(new URL("/admin/submissions", url).toString(), 303);
  }
  if (!authed) return forbidden();
  // Basic credentials ride along on cross-site form posts too, so a POST must come from this origin.
  const origin = request.headers.get("origin");
  if (request.method === "POST" && origin && origin !== url.origin) return forbidden();
  const db = env.DB;
  if (!db) return json({ error: "no database" }, 500);

  if (url.pathname === "/admin/cover" && request.method === "POST") {
    if (!env.AI) return json({ error: "no AI binding" }, 500);
    let body: { slug?: string; title?: string; description?: string; prompt?: string; seed?: number };
    try { body = await request.json(); } catch { return json({ error: "send JSON: {slug} or {title, description, prompt}" }, 400); }
    let story: string | undefined;
    if (body.slug) {
      story = builtins.storyFor(body.slug) ?? undefined;
      if (!story) {
        const row = await db.prepare("SELECT story_md FROM submissions WHERE slug = ?").bind(body.slug).first<{ story_md: string }>();
        story = row?.story_md;
      }
      if (!story && !body.prompt) return json({ error: `no story with slug ${body.slug}` }, 404);
    }
    if (!story && !body.prompt && !body.title) return json({ error: "send {slug} or {title, description, prompt}" }, 400);
    try {
      const c = await generateCover(env.AI, { prompt: body.prompt, title: body.title, description: body.description, story, seed: body.seed });
      log("admin_cover", { slug: body.slug ?? null, bytes: c.bytes.length });
      return new Response(c.bytes, { headers: { "content-type": c.contentType, "x-cover-prompt": encodeURIComponent(c.prompt).slice(0, 2000) } });
    } catch (e) {
      return json({ error: String(e).slice(0, 300) }, 502);
    }
  }

  // Speech for the home page's audio sample (worker/scripts/make-sample.mjs): one line of text in,
  // MP3 out, on Workers AI Aura. Key-gated like /admin/cover; nothing here is reachable without the key.
  if (url.pathname === "/admin/tts" && request.method === "POST") {
    if (!env.AI) return json({ error: "no AI binding" }, 500);
    let body: { text?: string; speaker?: string };
    try { body = await request.json(); } catch { return json({ error: "send JSON: {text, speaker}" }, 400); }
    const text = String(body.text ?? "").trim();
    if (!text || text.length > 1000) return json({ error: "text is required, 1000 characters at most" }, 400);
    try {
      const out = await env.AI.run("@cf/deepgram/aura-1", { text, speaker: body.speaker || "angus", encoding: "mp3" });
      const bytes = new Uint8Array(await new Response(out as BodyInit).arrayBuffer());
      log("admin_tts", { chars: text.length, bytes: bytes.length });
      return new Response(bytes, { headers: { "content-type": "audio/mpeg" } });
    } catch (e) {
      return json({ error: String(e).slice(0, 300) }, 502);
    }
  }
  // Transcribes posted audio (the sample's listen check) with Whisper; returns its text and word times.
  if (url.pathname === "/admin/stt" && request.method === "POST") {
    if (!env.AI) return json({ error: "no AI binding" }, 500);
    const audio = new Uint8Array(await request.arrayBuffer());
    if (!audio.length || audio.length > 5_000_000) return json({ error: "post the audio bytes, 5 MB at most" }, 400);
    try {
      // ?model=turbo uses whisper-large-v3-turbo (base64 input), a stricter second opinion.
      let b64 = "";
      if (url.searchParams.get("model") === "turbo") for (let i = 0; i < audio.length; i += 0x8000) b64 += String.fromCharCode(...audio.subarray(i, i + 0x8000));
      const r = url.searchParams.get("model") === "turbo"
        ? await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(b64), language: "en" })
        : await env.AI.run("@cf/openai/whisper", { audio: [...audio] });
      return json({ text: r?.text ?? "", words: r?.words ?? [] });
    } catch (e) {
      return json({ error: String(e).slice(0, 300) }, 502);
    }
  }

  const coverM = /^\/admin\/submissions\/([a-z0-9]+)\/cover$/.exec(url.pathname);
  if (coverM && request.method === "GET") {
    const row = await db.prepare("SELECT cover, cover_type FROM submissions WHERE id = ? AND cover IS NOT NULL").bind(coverM[1]).first<{ cover: ArrayBuffer; cover_type: string }>();
    if (!row) return notFound();
    return new Response(new Uint8Array(row.cover as ArrayBuffer), { headers: { "content-type": row.cover_type || "image/jpeg", "cache-control": "private, no-store" } });
  }

  const act = /^\/admin\/submissions\/([a-z0-9]+)\/(approve|reject|delete)$/.exec(url.pathname);
  if (act && request.method === "POST") {
    const [, id, action] = act;
    const row = await db.prepare("SELECT id, slug, status FROM submissions WHERE id = ?").bind(id).first<{ id: string; slug: string; status: string }>();
    if (!row) return json({ error: "no such submission" }, 404);
    if (action === "delete") {
      await db.batch([
        db.prepare("DELETE FROM submissions WHERE id = ?").bind(id),
        db.prepare("DELETE FROM submission_attempts WHERE submission_id = ?").bind(id),
      ]);
    } else {
      if (action === "approve" && builtins.slugs.has(row.slug)) return json({ error: `slug ${row.slug} is now a built-in story; change it before approving` }, 409);
      await db.prepare("UPDATE submissions SET status = ?, reviewed_at = ? WHERE id = ?").bind(action === "approve" ? "approved" : "rejected", Date.now(), id).run();
      // The cover is drawn here, by a person's approval on the admin page, never by an MCP tool.
      if (action === "approve" && env.AI) {
        const s = await db.prepare("SELECT story_md, cover IS NOT NULL AS has_cover FROM submissions WHERE id = ?").bind(id).first<{ story_md: string; has_cover: number }>();
        if (s && !s.has_cover) {
          try {
            const c = await generateCover(env.AI, { story: s.story_md });
            await db.prepare("UPDATE submissions SET cover = ?, cover_type = ?, cover_prompt = ? WHERE id = ?").bind(c.bytes, c.contentType, c.prompt, id).run();
          } catch (e) {
            log("cover_error", { id, message: String(e).slice(0, 200) });
          }
        }
      }
    }
    log("admin_submission", { id, action });
    const fromForm = /application\/x-www-form-urlencoded|multipart\/form-data/.test(request.headers.get("content-type") ?? "");
    return fromForm ? Response.redirect(new URL("/admin/submissions", url).toString(), 303) : json({ ok: true, id, action, slug: row.slug });
  }

  // Usage numbers for the admin dashboard and monitoring (src/stats.ts). JSON only, no story text.
  if (url.pathname === "/admin/stats.json" && request.method === "GET") {
    try {
      const stats = await adminStats(db, env, url.searchParams.get("days"));
      return new Response(JSON.stringify(stats), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex" } });
    } catch (e) {
      log("stats_error", { message: String(e).slice(0, 200) });
      return json({ error: "stats query failed" }, 500);
    }
  }

  if (url.pathname === "/admin/submissions" && request.method === "GET") {
    const all = url.searchParams.get("status") === "all";
    const { results } = await db.prepare(
      `SELECT id, created_at, status, title, slug, genre, story_md, secrets_md, contact, author_name, moderation, lint, cover_prompt, dev_marker,
              cover IS NOT NULL AS has_cover
       FROM submissions ${all ? "" : "WHERE status = 'pending'"} ORDER BY created_at DESC LIMIT 50`,
    ).all<Record<string, any>>();
    if ((request.headers.get("accept") ?? "").includes("application/json")) {
      return json((results ?? []).map(({ story_md, secrets_md, ...r }) => r));
    }
    return new Response(adminPage(results ?? [], all), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
  }
  return notFound();
}

function adminPage(rows: Record<string, any>[], all: boolean): string {
  const verdict = (v: any) => !v ? "not checked" : v.safe ? "safe" : `flagged ${v.categories.join(", ")}${v.refused ? "" : " (tolerated for crime fiction)"}`;
  const items = rows.map((r) => {
    let mod: any = {}, lint: any = {};
    try { mod = JSON.parse(r.moderation); } catch {}
    try { lint = JSON.parse(r.lint); } catch {}
    const form = (action: string, label: string) =>
      `<form method="post" action="/admin/submissions/${esc(r.id)}/${action}"${action === "delete" ? ' onsubmit="return confirm(\'Delete for good?\')"' : ""}><button>${label}</button></form>`;
    return `<article>
  <div class="head">
    ${r.has_cover ? `<img src="/admin/submissions/${esc(r.id)}/cover" alt="" width="160" height="160">` : '<div class="nocover">no cover</div>'}
    <div>
      <h2>${esc(r.title)} <small>${esc(r.slug)} · ${esc(r.genre)} · ${esc(r.status)}${r.dev_marker ? " · smoke test" : ""}</small></h2>
      <p>Submitted ${esc(new Date(r.created_at).toISOString().replace("T", " ").slice(0, 16))} UTC · id ${esc(r.id)}${r.contact ? ` · contact: ${esc(r.contact)}` : ""}</p>
      <p><b>Credit ("Written by", self-declared; check it):</b> ${r.author_name ? esc(r.author_name) : "<i>none given (the front matter's author is used)</i>"}</p>
      <p><b>Lint:</b> ${esc(lint.summary ?? "")}</p>
      <p><b>Moderation (${esc(mod.model ?? "")}):</b> story ${esc(verdict(mod.story))}; secrets ${esc(mod.secrets ? verdict(mod.secrets) : "none submitted")}</p>
      ${r.cover_prompt ? `<p><b>Cover prompt:</b> ${esc(r.cover_prompt)}</p>` : ""}
      <div class="actions">${r.status !== "approved" ? form("approve", "Approve and publish") : ""}${r.status !== "rejected" ? form("reject", "Reject") : ""}${form("delete", "Delete")}</div>
    </div>
  </div>
  ${lint.report ? `<details><summary>Lint report</summary><pre>${esc(lint.report)}</pre></details>` : ""}
  <details><summary>story.md (${r.story_md.length.toLocaleString()} chars)</summary><pre>${esc(r.story_md)}</pre></details>
  ${r.secrets_md ? `<details><summary>secrets.md (${r.secrets_md.length.toLocaleString()} chars, private)</summary><pre>${esc(r.secrets_md)}</pre></details>` : "<p><b>No secrets.md.</b></p>"}
</article>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Submissions · Plot Speaks admin</title>
<style>
:root{--ink:#12355B;--accent:#F07A22;--bg:#fbf8f3;--line:#e3d9cc}
@media (prefers-color-scheme: dark){:root{--ink:#eef3f8;--bg:#0d1b2a;--line:#2a3d55}}
body{margin:0;padding:16px;font:15px/1.5 system-ui,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:960px;margin:auto}h1{margin:.2em 0}h2{margin:0;font-size:1.15em}h2 small{font-weight:400;opacity:.7}
article{border:1px solid var(--line);border-radius:10px;padding:12px;margin:14px 0}.head{display:flex;gap:14px;flex-wrap:wrap}
img,.nocover{width:160px;height:160px;border-radius:8px;object-fit:cover;flex:none}.nocover{display:grid;place-items:center;border:1px dashed var(--line)}
.head>div{flex:1;min-width:240px}p{margin:.3em 0}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--accent);background:transparent;color:inherit;cursor:pointer}
pre{white-space:pre-wrap;word-break:break-word;max-height:480px;overflow:auto;font-size:13px;border-top:1px solid var(--line);padding-top:8px}
</style></head><body><main>
<h1>Submissions</h1>
<p>${all ? 'All (latest 50). <a href="/admin/submissions">Pending only</a>' : 'Pending. <a href="/admin/submissions?status=all">Show all</a>'}</p>
${items || "<p>Nothing waiting for review.</p>"}
</main></body></html>`;
}
