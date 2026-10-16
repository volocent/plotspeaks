# check-story

Zero-dependency lint for Plot Speaks stories (Node 24, plain ESM). The Worker's `review_story` tool and `submit_story` run the same rules: `rules.mjs` holds pure functions that take strings (the Worker bundles it), and `check-story.mjs` is the only file that touches the disk or git.

## Run

    node tools/check-story/check-story.mjs                          # every folder under stories/
    node tools/check-story/check-story.mjs stories/example-dinner-party
    node tools/check-story/check-story.mjs --json
    node --test "tools/check-story/test/*.test.mjs"

Output is `ERROR|WARN <file>:<line> <rule> — <message>` per finding, then `<slug>: N errors, M warnings`. Exit code 1 if any ERROR, else 0.

## What it checks (rule ids)

- `front-matter`, `srd-attribution`: required fields and allowed values; `name` should equal `plotspeaks-<folder>`; SRD 5.2.1 stories must carry the CC-BY-4.0 attribution.
- `required-sections`, `stop-phrase`: How to run this, Cast (WARN for adventures), a Chapter, Endings; the pause and resume phrases in the GM instructions.
- `chapters`, `recap-block`, `chapter-duration`, `duration-sum`: chapter count matches metadata, each chapter has a `### Recap block`, 20-40 minute chapters, total near `duration_minutes`.
- `read-aloud`: more than 3 sentences is an ERROR, 1 sentence a WARN. Recap blocks are exempt.
- `no-audio-cues` (story.md and secrets.md): sound-effect, music and voice-switching cues. Prohibitions such as "never produce sound effects" are exempt.
- `denylist` (story.md and secrets.md): protected names and settings, from `denylist.txt`.
- `secrets`: secrets.md exists, is not tracked by git, and is gitignored.
- `wrangler-cues`: each `**Wrangler cue:** S<n>` has a `## S<n>` heading in secrets.md; uncued secrets sections WARN.
- `accusation-handoff`, `resume-chapter`: murder-mysteries need "Wrangler, check the secrets" in the GM instructions; stories with more than one chapter need "resume from chapter".
- `cue-parts`: each `## S<n>` secrets section should have `**Read aloud to the narrator:**` and `**Wrangler only (don't read):**` (WARN). Follow-up sections such as `S3b` need no cue of their own when `S3` is cued.
- `spoiler-hint`, `hidden-clue`: cheap heuristics (WARN).
- `spoken-intro`: the story opens with the spoken introduction the narrator can skip on request (ERROR when missing).
- `read-aloud-length`: a read-aloud beat over 45 words (40 in family stories) is a WARN; the Full reveal section is exempt.
- `culprit-tell`: story.md must not name the culprit in a GM trigger or mark only the culprit's cast row "until confronted" (ERROR); other GM mentions WARN.
- `full-reveal`: every mystery's secrets.md needs a `## Full reveal` section with a `**Read aloud:**` part (160 words at most) and `**What became of them:**` bullets.

## What it does not check

Fair play is judgment, not lint. A human or agent reviewer must still confirm the FORMAT.md checklist items: every suspect has motive, means and opportunity; the culprit is reachable from the clues without guessing; at least two red herrings with innocent explanations; nothing in story.md leaks the solution beyond the crude phrase heuristic. The lint also cannot tell whether a denylist-clean story is derivative.

## Extending the denylist

Add one term per line to `denylist.txt` under the matching `#` header. Matching is case-insensitive and whole-word; spaces match any whitespace. Use full phrases (a bare surname that is also a common word will cause false positives). There is no per-story override by design.

`cold-open` (added 2026-10-15): unlabelled paragraphs between the `# Title` and the first `##` heading are read aloud as the cold open, so each is held to 3 sentences. `read-aloud` also covers labelled beats (`**Read aloud (cold open, beat 1):**`) and the `**Read aloud to the narrator:**` parts of secrets.md cue sections.
