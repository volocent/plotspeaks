# Plot Speaks story format, v0.1

A story is a folder `stories/<slug>/` holding:

- `story.md` — public. Everything the assistant needs to run the game, and nothing that spoils it. SKILL.md-compatible so it can be installed as a skill or served by the MCP server.
- `secrets.md` — private. The solution and anything else the player must not see. Never committed (see `.gitignore`). In Phase 1 the GM-wrangler passenger holds it; in Phase 2 the Worker serves it one answer at a time through `check_accusation`, `get_cue` and `reveal_solution`.

Simulated playtests on 2026-10-15 (`docs/TESTING.md`) showed that narrators run long, invent details and volunteer hidden clues unless the GM instructions say otherwise, and that the rules below fix most of it (median turn 60–114 words before, 41–59 after). Design constraints that shaped this (see `docs/research-report.md`, "Voice and in-car reality check"):

- One narrator doing accents. No sound-effect cues, no music, no "switch to a gravelly voice." Voice direction is prose stage direction ("the butler speaks slowly, with a Yorkshire lilt").
- Chapters of 20–40 minutes. Each ends with a **recap block** the narrator reads aloud so the game survives a fresh session or a lost connection.
- Read-aloud beats are 2–3 sentences, then a question or a choice. Long monologues die in a car.
- Anything in `story.md` is visible to the player. Only `secrets.md` is hidden, and even that is honor-system until Phase 2.

## story.md

```markdown
---
name: plotspeaks-<slug>
description: Run "<Title>", a <N>-minute <genre> for <players> players. Use when the user asks to play <Title> or a Plot Speaks <genre>.
license: CC-BY-NC-4.0            # free stories; paid stories use All-Rights-Reserved + Plot Speaks distribution license
metadata:
  title: <Title>
  genre: murder-mystery           # murder-mystery | adventure | horror | heist | kids
  duration_minutes: 30
  chapters: 1
  players: 1-4
  rating: PG-13                   # G | PG | PG-13 | R (R is not publishable to ChatGPT plugins yet)
  version: 0.1.0
  author: <name or handle>
  voice_ready: true
  rules_system: none              # none | srd-5.2.1 | orc
  ai_disclosure: human-written    # human-written | ai-assisted | ai-generated
---

# <Title>

**Read aloud (cold open, beat 1):** The pitch, 2–3 sentences.

**Read aloud (cold open, beat 2):** Optional second beat, 2–3 sentences, ending in a question.

## How to run this (GM instructions)

- Voice rules (these matter most): every turn is at most three short sentences, about 50 words, then one question. Character dialogue counts toward the three. One character speaks per turn. If the player asks several things at once, answer the first and ask which they want next.
- Spoken intro (skippable): before the cold open the narrator asks "Would you like a quick how-to-play first, or shall we jump straight in?" and, if wanted, reads the story's `## How to play (spoken intro)` beats (three read-aloud beats: what you can do; how to accuse, or how dice work; the pause/resume/wrap-up phrases). Offered once, never on resume (Ben, 2026-10-16).
- Questioning is event-based too: a suspect tells their account when asked, then repeats it until confronted with a clue. No question counts (narrators don't keep them).
- You are the narrator and every character. One voice, accents and pacing to distinguish people. Never produce sound effects or music.
- Never reveal the solution, the culprit, or any clue marked *hidden* until the player formally accuses or says the stop phrase. A *hidden* clue is not mentioned, hinted at or described in passing until the player does the action in its brackets.
- Stick to this file. Add colour freely (weather, gestures, tone), but never add objects, documents, times, places people were, or things people said that are not written here. If asked something this file doesn't answer, the character doesn't know. A place holds only what its read-aloud and Available line list (playtest narrators invented drawers, cupboards and a second glass, which became false leads).
- **A cue belongs to its scene.** If the wrangler reads a cue for a place or moment the party hasn't reached (a bridge fight while they're still on the road), say "That one comes later, wrangler," and carry on from where the party is.
- Describe, don't deduce. Say what is seen or heard and what a thing is, then stop. Never say which person a clue fits; the player makes every connection. (A playtest narrator said a suspect's slippers matched the footprint, which handed the player the culprit.)
- Address the player by the name they gave; never guess their gender (a playtest narrator called the same player "Mr." and "miss").
- Keeping it moving: if the player's last three turns turned up nothing new, the next unfound lead from the story's ordered lead list is volunteered by the person named, in one sentence.
- Pacing: trigger every pacing beat (a chapter end, a forced scene, a lead, the out-of-time ending) on something the narrator can observe in the conversation: a scene visited, a clue found, a named action ("once the player has examined the radio and watched the replay"), or a run of turns that found nothing new. Never on an exchange count or minutes: a narrator has no clock and does not count turns. A count may appear only as a rough backstop ("if it feels like a long time and the player is circling, end the chapter"). Evidence: in simulated play on 2026-10-15, exchange-count triggers ("Chapter 1 ends at exchange 20") were skipped or fired late in most runs, while event triggers ("if the player's last three turns turned up nothing new") fired in every run of all three stories.
- Stop phrase: "Plot Speaks, pause the story." Resume phrase: "Plot Speaks, resume." (read the latest recap block). In a fresh session, "Plot Speaks, resume from chapter N" means: read the recap block at the end of chapter N−1, then start chapter N's first scene.
- Wrap-up phrase: "Plot Speaks, wrap it up." (for when the drive is ending or the story drags; players who held the evidence often never accused). Read the recap, with only the clues the player has actually found, then head for the end. Mysteries: run the "Out of time" ending, which asks for an accusation. Adventures: summarise the travel in one sentence, naming no room the party hasn't entered, and play the final scene. Every story wires this phrase to its own out-of-time or final-scene path.
- Accusation: when the player says "I accuse <name>," say "Wrangler, check the secrets." and wait (through the connector, the build rewrites this into a `check_accusation` call: see "Connector version" below) for the GM-wrangler to read the matching line from `secrets.md` (Phase 1). Then run the ending for that outcome. The GM instructions must say that the wrangler's line is the truth and overrides the file, because suspects' public accounts can be lies: in a playtest a narrator rejected a correct solution as contradicting the culprit's own alibi.
- Wrangler cues (optional, mostly adventures): where a scene says `**Wrangler cue:** S<n>`, always say "Wrangler, cue S<n>." and wait, even if unsure a wrangler is listening; never invent what the cue would have said; in Phase 1 the wrangler speaks into the same microphone as the players, so the GM instructions must tell the narrator to accept the next message starting "Wrangler" without doubting its source (a playtest narrator refused a correct solution because it "came in your message"); the GM-wrangler reads section `## S<n>` of `secrets.md` aloud. Because the players hear it too, each `## S<n>` section has two labelled parts: `**Read aloud to the narrator:**` (only what happens now, safe to hear) and `**Wrangler only (don't read):**` (what to listen for, and follow-up cues such as S3b that the wrangler calls with "Narrator, cue S3b."). Through the connector the build rewrites these into `get_cue` calls (see "Connector version" below).
- Safety: if the player asks to skip a topic, skip it without comment. Keep violence off-screen; this is a puzzle, not a splatter film.
- Dice (adventure genre only): ask the player to roll, or roll openly and state the number before interpreting it. Never fudge.

## Setting

Where and when. Two or three sentences the narrator can riff on.

## Cast (public information only)

| Name | Role | What everyone knows | Voice note |
|---|---|---|---|
| ... | ... | ... | ... |

## Chapter 1 — <title> (≈30 min)

### Scene 1.1 — <title>
**Read aloud:** 2–3 sentences.
**Available:** what the player can examine, who they can question, exits.
**Clues here:** list; mark *hidden* clues that require a specific action.
**Leads to:** 1.2, 1.3

### Scene 1.2 — ...

### Recap block (read aloud at chapter end)
"So far you have learned ... You still have not ... When you're ready, say 'Plot Speaks, resume.'"

## Endings

- **Verdict first:** every `## Endings detail` line in secrets.md starts with **Correct.** or **Innocent.**; the narrator turns it into "Congratulations, detective. You've solved it." or "I'm sorry. You've accused an innocent person." before the rest of the line (Ben, 2026-10-15: players need a clear win or miss).
- **Correct accusation:** read-aloud ending.
- **Wrong accusation:** read-aloud ending, then offer one more try or the reveal.
- **Out of time** (the player says "Plot Speaks, wrap it up," or an observable event the story names, such as the player declining to name anyone twice after the final forced scene): read the recap, then ask for an accusation.
```

## secrets.md

```markdown
# <Title> — secrets (never share with the player)

- Culprit: <name>
- Motive / means / opportunity: ...
- Timeline of the crime: ...
- Clue schedule: which clue proves what, and the minimum set needed to solve it fairly
- Red herrings and why each is innocent
- Answers to likely player questions the narrator must handle without leaking

## Endings detail
- **<Name> (correct):** Correct. <how it was done>
- **<Name> (wrong):** Innocent. <the fact that clears them>

## Full reveal
**Read aloud:** <plain prose, 160 words or fewer in all; who did it, why, and the clues that pointed there; no real-world method>

<optional second paragraph, still part of the read-aloud>

**What became of them:**
- <Name>: <one sentence>
- <Name>: <one sentence>
```

### `## Full reveal` (mysteries)

Every mystery's wrong-accusation ending offers "one more accusation, or the full reveal?", and the correct ending asks "Would you like to hear what became of each of them?". Both are answered from this section, by the `reveal_solution` tool (connector) or the passenger page's **Full reveal** button (paste play). Review 2026-10-16, item B3.

- `**Read aloud:**` is everything up to `**What became of them:**`, one or more paragraphs, read aloud as the solution. Plain prose: no markdown inside, 160 words or fewer in all, no real-world method for any poison or weapon. The `read-aloud` sentence rule doesn't apply here; the `full-reveal` lint rule checks the length and that both parts exist (WARN).
- `**What became of them:**` is a list, one `- <Name>: <one sentence>` per character. The narrator reads it only if the player says yes to hearing what became of everyone.
- `reveal_solution` is gated: it answers only once the play has an accusation on record, or when the player says they give up. Adventures have no full reveal.

## Connector version of story.md

`story.md` stays written for paste play (the passenger "wrangler" hand-offs above), and the site serves it as written. `tools/worker-data/build.mjs` (and the Worker, for approved submissions) builds the version `start_story` serves with `tools/worker-data/connector.mjs`: the front matter becomes a one-line header; the accusation hand-off becomes a `check_accusation` call; the solo-play line, the wrangler trust sentences ("the wrangler's line is the truth", "same microphone") and "That one comes later, wrangler" go; "Wrangler, cue S2" and "Narrator, cue S2c" (also in cue notes and the Listen-for table) become `get_cue` calls; the full-reveal offers point at `reveal_solution`. Curly quotes are straightened first. Two-chapter stories are served one chapter at a time, chapter 2 with chapter 1's recap at its top. Any sentence still mentioning the wrangler after the rewrites is dropped, and the build prints it, so write hand-offs in the standard wording above.

## Fair-play checklist (what `review_story` checks or asks the writer's assistant to check)

- [ ] Every suspect has a stated motive, means and opportunity in `secrets.md`
- [ ] The culprit is reachable from clues available in `story.md` without guessing
- [ ] At least two red herrings, each with an innocent explanation
- [ ] Every chapter is 20–40 minutes and ends with a recap block
- [ ] No sound-effect, music or voice-switching cues anywhere
- [ ] Read-aloud beats ≤ 3 sentences
- [ ] An ordered lead list per chapter, so a stuck player is nudged forward
- [ ] Pacing triggers are events the narrator can observe, never exchange counts; the GM instructions define "Plot Speaks, wrap it up" and wire it to the out-of-time ending or final scene
- [ ] Simulated play (`tools/playtest`, see `docs/TESTING.md`): no leak, median narrator turn ≤ about 50 words, a `curious` run reaches an accusation
- [ ] Front matter complete; `rating` and `ai_disclosure` set
- [ ] No protected names or settings (franchise characters, Clue's cast, SRD-excluded creatures such as beholders or Strahd)
