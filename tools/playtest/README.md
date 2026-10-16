# Plot Speaks playtest harness

Simulates a spoken Plot Speaks session in text, so a story can be tested without a car. Zero dependencies (Node 24, ESM).

## What it runs

Separate Claude Code CLI conversations (headless, `claude -p`, so information is truly isolated):

- **Narrator** (`--solo`: uses `dist/solo/<slug>-solo.md` with the secrets inside, see tools/solo; wrangler cues never fire) - system prompt is a short voice-mode framing plus the full `story.md`. With `--secrets with` it also gets `secrets.md` under a "GM-ONLY SECRETS" header, to test whether a narrator holding the answer leaks it. Continued across turns with `--resume`.
- **Player** - a persona (`personas.mjs`: `curious`, `adversarial`, `drifter`, `adventurer`). It never sees `story.md` or `secrets.md`.
- **Wrangler** - code, not a model. On "Wrangler, check the secrets" it finds the accused name in the player's last "I accuse ..." line and sends the matching `## Endings detail` line. On "Wrangler, cue S<id>" it sends the `Read aloud to the narrator` part (plus `Numbers`) of `## S<id>`. "Wrangler only" text is never sent. Follow-up cues (S3b etc.) are not simulated.
- **Judge** - one call after the session with story, secrets and transcript; returns strict JSON (leaks, coherence breaks, format counts, hand-off, resume, outcome). Parsed defensively, one retry.

Every call runs in an empty temp directory with `--tools ""`, `--system-prompt-file`, `--strict-mcp-config`, `--setting-sources ""` and `--disable-slash-commands`, so no project CLAUDE.md, MCP servers, hooks or the ~68k-token Claude Code prompt load. Calls are sequential.

## Run

```
node tools/playtest/playtest.mjs stories/example-dinner-party --persona curious --narrator-model haiku --player-model haiku --judge-model sonnet --turns 30
node tools/playtest/playtest.mjs stories/example-dinner-party --persona adversarial --secrets with
node tools/playtest/playtest.mjs stories/keepers-bell --persona adventurer --resume-test --split-at 12
node tools/playtest/playtest.mjs stories/example-dinner-party --dry-run      # canned replies, no CLI calls
node tools/playtest/summarize.mjs                                            # table of every result
node --test tools/playtest/test/lib.test.mjs                                  # unit tests
```

Options: `--persona`, `--narrator-model`, `--player-model`, `--judge-model` (default sonnet), `--secrets without|with`, `--turns` (default 30), `--resume-test`, `--split-at N`, `--seed label`, `--dry-run`. The session also ends on an accepted ending after the wrangler line, or if the player says "Plot Speaks, end the story".

`--resume-test` starts a NEW narrator conversation (no memory) at "resume from chapter 2" in the narrator's output, or at exchange N, and sends "Plot Speaks, resume from chapter 2." plus a "We found ..." summary written by the player model.

The CLI is found under `%USERPROFILE%\.vscode\extensions\anthropic.claude-code-*` (newest); override with `CLAUDE_BIN`.

Output goes to `playtests/<slug>/<timestamp>-<persona>-<narratorModel>-<secrets>.md` (transcript, wrangler injections marked, judge JSON) and `.json` (everything, with per-call usage). `playtests/` is gitignored because transcripts can contain solutions.

## Cost

It uses the logged-in claude.ai subscription through the CLI. No API key, no cash. `total_cost_usd` in the JSON is notional. It does consume plan usage: a 30-exchange haiku run is roughly 30 narrator + 30 player calls plus the judge, and the judge (full story, secrets and transcript) is the biggest single call.

## What it can't tell you

- **Voice**: no speech, accents, pacing, interruptions or ASR errors. Players here are text-perfect.
- **ChatGPT**: narrator and player are Claude models. Behavior in ChatGPT voice or Projects can differ a lot.
- **Real car conditions**: no noise, lock screens, dropped connections, driver distraction beyond the `drifter` script, or real session-length decay.
- **A real wrangler**: it is a deterministic script; a human passenger will paraphrase, be slow, or misread.
- **Judge reliability**: it is a model reading a transcript; spot-check its flagged quotes and sample unflagged turns.
