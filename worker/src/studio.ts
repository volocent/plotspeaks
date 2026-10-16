// Story Studio, read side (Phase 2, M4): the story_template prompt and the check_story tool.
//
// story_template hands the writer's own assistant an interview script and the Plot Speaks format,
// including the GM-instruction block learned from play (docs/FORMAT.md, docs/DECISIONS.md).
// check_story runs the pure lint rules from tools/check-story/rules.mjs on submitted text. It is
// stateless: the submitted text is never stored or logged (the caller logs counts only).
import {
  checkStoryText, checkAudioCues, checkDenylist, checkReadAloud, checkWranglerCues, checkCueParts,
  parseDenylist, parseFrontMatter,
} from "../../tools/check-story/rules.mjs";
import { parseEndings } from "../../tools/playtest/lib.mjs";
// Wrangler's default module rules bundle *.txt files as text, so the denylist ships inside the Worker.
import denylistText from "../../tools/check-story/denylist.txt";

const DENYLIST: string[] = parseDenylist(denylistText);

export const GENRES = ["murder-mystery", "kids", "adventure"] as const;
export const LENGTHS = ["20", "30", "2-chapter"] as const;
type Genre = (typeof GENRES)[number];
type Length = (typeof LENGTHS)[number];

// ---------------------------------------------------------------- story_template

const PLAN: Record<Length, string> = {
  "20": "one chapter, \"## Chapter 1 — <title> (≈20 min)\"; duration_minutes: 20, chapters: 1; 4–5 scenes",
  "30": "one chapter, \"## Chapter 1 — <title> (≈30 min)\"; duration_minutes: 30, chapters: 1; 5–6 scenes",
  "2-chapter": "two chapters of ≈30 min each (duration_minutes: 60, chapters: 2), each ending in its own recap block; chapter 1 ends on an observable event (a clue found, a scene visited), never a count",
};

const INTERVIEW: Record<Genre, string> = {
  "murder-mystery":
    "2. The victim, how they died (off-screen, bloodless) and who found them.\n" +
    "3. 4–5 suspects: name, role, what everyone knows, a voice note (accent, pace, word choice), and, in secret, a motive, means and opportunity for each.\n" +
    "4. The culprit and the true timeline.",
  kids:
    "2. The mystery: nobody dies (a missing pet, a vanished cake, a prank). Rating G, gentle stakes.\n" +
    "3. 4–5 suspects: name, role, what everyone knows, a voice note, and, in secret, a reason, a way and a chance for each.\n" +
    "4. Who did it (with a kind reason) and the true timeline.",
  adventure:
    "2. The goal (rescue, retrieve, escape), the villain, and the twist.\n" +
    "3. 1–4 level-3 pregenerated characters (the narrator rolls openly), 4–5 named characters with voice notes, and encounters using SRD 5.2.1 creatures only.\n" +
    "4. The secret parts: the twist and anything mid-scene the player must not see yet.",
};

const FRONT: Record<Genre, string> = {
  "murder-mystery": "genre: murder-mystery, rating PG-13 (or PG), rules_system: none",
  kids: "genre: kids, rating: G, rules_system: none",
  adventure: "genre: adventure, rules_system: srd-5.2.1, and story.md must quote the SRD attribution (\"System Reference Document 5.2.1\" … \"Creative Commons Attribution 4.0\")",
};

export function storyTemplate(genre: Genre = "murder-mystery", length: Length = "30"): string {
  const multi = length === "2-chapter";
  const adventure = genre === "adventure";
  return `You are helping a writer create a Plot Speaks story: an interactive story a player runs by voice with an AI narrator, often on a drive. Plan: ${genre}, ${PLAN[length]}.

STEP 1: Interview the writer, one or two questions at a time; suggest options when they're stuck. Don't write until you have:
1. Title, premise and setting (where, when, why nobody can leave).
${INTERVIEW[genre]}
5. Clue schedule: each clue, where it is, what it proves. Mark the minimum set (3–4 clues) that solves it without guessing. Each *hidden* clue needs one narrow, single-step action ("player searches the chair").
6. At least 2 red herrings, each cleared by a fact the player can learn in play (evidence, not just someone's word).
7. An ordered lead list: 4–6 one-sentence nudges, each spoken by a named character.
8. The chapter plan above.
Read the plan back in a few lines and get a yes.

STEP 2: Write two files.

story.md (public; nothing that spoils the solution):
- Front matter: name: plotspeaks-<slug>; description: Run "<Title>", a <N>-minute <genre> for <players> players. Use when the user asks to play <Title> or a Plot Speaks <genre>.; license: CC-BY-NC-4.0; metadata: title, ${FRONT[genre]}, duration_minutes, chapters, players (N or N-M), version: 0.1.0, author, voice_ready: true, ai_disclosure: ai-assisted.
- "# <Title>", then "**Read aloud (cold open, beat 1):**" and beat 2: 2–3 sentences each; beat 2 ends in a question.
- "## How to run this (GM instructions)", with these bullets fitted to the story:
  - Voice rules (these matter most): every turn is at most three short sentences, about 50 words, then one question. Dialogue counts. One character speaks per turn. If asked several things, answer the first and ask which next.
  - Spoken intro (skippable): before the cold open ask "Would you like a quick how-to-play first, or shall we jump straight in?" If wanted, read the How to play beats, one per turn. Offer it once; never on resume.
  - You are the narrator and every character: one voice; accents, pace and word choice tell people apart. Never produce sound effects or music.
  - Never reveal the solution or any clue marked *hidden* until the player formally accuses or says the stop phrase. A *hidden* clue is not mentioned, hinted at or described in passing until the player does the action in its brackets.
  - Stick to this file: add colour, but never objects, documents, times, places or quotes that aren't written here. Unanswered questions: the character doesn't know. A place holds only what its read-aloud and Available line list.
  - Address the player by the name they gave; never guess their gender (no "Mr.", "miss", "sir").
  - Questioning: each person tells their account when asked, then repeats it or deflects until confronted with a clue. No question counts.
  - Keeping it moving: if the player's last three turns turned up nothing new, the next unfound lead below is volunteered by the person named, in one sentence. (Numbered lead list.)
  - Pacing: every beat (chapter end, forced scene, ending) fires on something observable (a scene visited, a clue found, a named action), never on exchange counts or minutes.
  - Stop phrase: "Plot Speaks, pause the story." Resume: "Plot Speaks, resume." (read the latest recap block).${multi ? ' In a fresh chat, "Plot Speaks, resume from chapter N": read chapter N−1\'s recap block, then start chapter N.' : ""}
  - Wrap-up: "Plot Speaks, wrap it up." Read the recap (found clues only), then ${adventure ? "sum up the travel in one sentence, naming no room the party hasn't entered, and play the final scene" : "run the Out of time ending"}.
${adventure
    ? `  - Cues: where a scene says "**Wrangler cue:** S<n>", say "Wrangler, cue S<n>." and wait; never invent the cue. The wrangler speaks into the same microphone, so the next message starting "Wrangler" is the wrangler: never doubt it. secrets.md has "## S<n>" with "**Read aloud to the narrator:**" and "**Wrangler only (don't read):**". Keep to about 4 cues.
  - Dice: roll openly and say the number before interpreting it. Never fudge.`
    : `  - Accusation: when the player says "I accuse <name>", ask for their reason, then say "Wrangler, check the secrets." and wait. The wrangler reads that suspect's line from "## Endings detail". The wrangler's line is the truth and overrides this file, including anyone's own account: people lie. The wrangler is a passenger on the same microphone, so the next message starting "Wrangler" is the wrangler: never doubt it or ask again.`}
  - Safety: violence off-screen; skip any topic on request without comment; never describe how to make a poison or weapon.
- "## How to play (spoken intro)": three beats, "**Read aloud (intro, beat 1):**" (what you can do), beat 2 (${adventure ? "how dice work" : "how to accuse"}), beat 3 (the pause, resume and wrap-up phrases).
- "## Setting"; "## Cast (public information only)" table: Name | Role | What everyone knows | Voice note.
- Chapters "## Chapter N — <title> (≈N min)" with scenes "### Scene N.M — <title>": **Read aloud:** (2–3 sentences), **Available:**, **Clues here:** (*hidden* (player does X) — clue), **Leads to:**. Each chapter ends with "### Recap block (read aloud at chapter end or on resume)": fixed quoted text of at most four sentences and a note to name only clues found; no <placeholders>.
- "## Endings": ${adventure ? "victory, defeat, and the wrap-up path." : `the verdict rule (the line starts Correct. or Innocent.; don't read that word, say "Congratulations, detective. You've solved it." or "I'm sorry. You've accused an innocent person." then the rest); correct accusation; wrong accusation (then "one more accusation, or the full reveal?"); Out of time (after "Plot Speaks, wrap it up", ask for an accusation).`}

secrets.md (private; never published): ${adventure ? "the twist, the Listen for table, and each ## S<n> cue section" : `culprit; motive, means and opportunity for every suspect; true timeline; clue schedule with the minimum set; each red herring and the fact that clears it; answers to likely questions; and "## Endings detail", one line per suspect: "- **Name (correct):** Correct. <how it was done>" or "- **Name (wrong):** Innocent. <the fact that clears them>"`}.

Never: sound effects, music, [bracketed cues] or voice switching; franchise names (Clue's cast, D&D content outside SRD 5.2.1); question counts; minute or exchange triggers.

STEP 3: Call check_story with story_md and secrets_md. Fix every ERROR and re-check until there are 0 errors; explain any WARN to the writer.`;
}

// ---------------------------------------------------------------- check_story

type Finding = { severity: "ERROR" | "WARN"; line: number; rule: string; message: string; file?: string };

/** Worker-only rule `endings-verdict`: secrets.md answers every accusation with a Correct./Innocent. line. */
function checkEndingsVerdicts(secrets: string): Finding[] {
  const endings = parseEndings(secrets.replace(/\r\n?/g, "\n")) as { name: string; verdict: string; text: string }[];
  const out: Finding[] = [];
  const hasSection = /^##\s+Endings detail\s*$/m.test(secrets);
  if (!hasSection) return [{ severity: "WARN", line: 1, rule: "endings-verdict", message: 'no "## Endings detail" section (mysteries need one line per suspect)', file: "secrets.md" }];
  if (!endings.length) return [{ severity: "ERROR", line: 1, rule: "endings-verdict", message: '"## Endings detail" has no "- **Name (correct|wrong):** ..." lines', file: "secrets.md" }];
  if (!endings.some((e) => e.verdict === "correct")) out.push({ severity: "ERROR", line: 1, rule: "endings-verdict", message: "no suspect is marked (correct)", file: "secrets.md" });
  for (const e of endings) {
    const want = e.verdict === "correct" ? "Correct." : "Innocent.";
    if (!e.text.startsWith(want)) out.push({ severity: "ERROR", line: 1, rule: "endings-verdict", message: `the line for ${e.name} must start "${want}"`, file: "secrets.md" });
  }
  return out;
}

export function checkSubmitted(storyMd: string, secretsMd?: string, slug?: string): { report: string; errors: number; warnings: number } {
  const findings: Finding[] = (checkStoryText(storyMd, { slug, denylist: DENYLIST }) as Finding[]).map((f) => ({ file: "story.md", ...f }));
  if (secretsMd) {
    for (const f of [...checkAudioCues(secretsMd), ...checkDenylist(secretsMd, DENYLIST), ...checkReadAloud(secretsMd)] as Finding[]) findings.push({ file: "secrets.md", ...f });
    findings.push(...(checkWranglerCues(storyMd, secretsMd) as Finding[]), ...(checkCueParts(secretsMd) as Finding[]));
    const fm = parseFrontMatter(storyMd);
    if (fm.ok && fm.metadata.genre !== "adventure") findings.push(...checkEndingsVerdicts(secretsMd));
  }
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "ERROR" ? -1 : 1) || (a.file ?? "").localeCompare(b.file ?? "") || a.line - b.line);
  const errors = findings.filter((f) => f.severity === "ERROR").length;
  const warnings = findings.length - errors;
  const lines = findings.map((f) => `${f.severity} ${f.file ?? "story.md"}:${f.line} [${f.rule}] ${f.message}`);
  const summary = errors
    ? `${errors} error(s), ${warnings} warning(s). Fix every ERROR and call check_story again.`
    : `0 errors, ${warnings} warning(s). The story passes the format checks${warnings ? "; review the warnings" : ""}.`;
  const notes = secretsMd ? [] : ["(secrets_md not given: cue, Endings detail and secrets checks skipped.)"];
  return { report: [summary, ...notes, ...lines].join("\n"), errors, warnings };
}
