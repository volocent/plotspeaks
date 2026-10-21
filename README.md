# Plot Speaks

**Bring your own AI.** Plot Speaks is a library of murder mysteries, choose-your-path adventures, trivia
boards, party games, open worlds and wind-downs that your own AI assistant plays with you out loud. The
assistant narrates and hosts; the Plot Speaks server (a remote MCP server) keeps every answer key, rules on
every accusation and trivia answer, and gives up one line at a time. Live at **https://plotspeaks.com**.
A Volocent Labs LLC product.

**Assistant-agnostic by design.** The same server runs today in **Claude** (free plan, voice mode) and
**Gemini** (custom connector), and any MCP client can connect to `https://plotspeaks.com/mcp` (no sign-in)
or `https://account.plotspeaks.com/mcp` (OAuth 2.1, Google sign-in, progress kept). It was built to Alexa's
published MCP add-on requirements; once Amazon opens the Alexa+ for Builders preview to us, the same server
connects to Alexa+ unchanged, with the trivia watch page as the Echo Show game view. See
[`docs/alexa/`](docs/alexa/) for the readiness notes and draft manifest, and
[`docs/FRICTION-LOG.md`](docs/FRICTION-LOG.md) for what stood in the way.

**What's in the library:** 20 murder mysteries (one a six-chapter weekly season), gamebook adventures with
shareable path codes, ten general trivia boards (1,800+ clues), Team Trivia for 356 teams with today's
roster, Ballpark estimates, a daily board everyone plays with the same deal, head-to-head by code, Werewolf,
Twenty Questions, open worlds that remember you, six wind-downs. Every ending asks for a one-to-five star
rating; a disputed trivia ruling goes to three independent AI judges and an upheld challenge teaches the
board for everyone. Anyone can write and submit a story by voice in Story Studio; submissions are screened
(Llama Guard, two-of-three vote) and reviewed by a person before they are listed.

This repository is the scanned public export of the project: the server, the story format and the stories
(without their answer keys), the lint and playtest tools, and the technical design.

## What's here

```
stories/        the published stories (murder mysteries, family mysteries, SRD adventures); catalog.json lists them
docs/FORMAT.md  the story format: front matter, GM instructions, scenes, recaps, endings
docs/PLAY.md    how to play a story today
docs/architecture.svg  the technical design of the whole solution
docs/alexa/     Alexa+ add-on readiness notes and the draft listing manifest (addon.json)
docs/FRICTION-LOG.md  what stood in the way of the Alexa+ add-on, entry by entry
tools/          check-story (lint), playtest (simulated play), solo, worker-data (connector build and matching)
worker/         the Plot Speaks MCP server (Cloudflare Worker)
```

## Run it yourself

    cd worker
    npm install
    npm run data                                   # builds the stories into the Worker
    npx wrangler d1 migrations apply plotspeaks-dev --local
    npx wrangler dev --port 8799                   # http://127.0.0.1:8799

Then point any MCP client at `http://127.0.0.1:8799/mcp` (no sign-in is needed locally), or browse the site at
the same address. Two sample stories with invented answer keys, `stories/sample-harbor-lantern` (a short
mystery) and `stories/sample-trivia`, play end to end from this repository; the published stories' keys stay
private, so those play only on the live server, `https://plotspeaks.com/mcp`. The sign-in host (Google,
OAuth 2.1) needs its own secrets and isn't part of a local run.

## Answer keys are not in this repo

Each story has a private answer key (who did it, and how). It is never published: the connector serves only the one line needed when a player accuses someone. That is why `tools/` and `worker/` refer to `secrets.md` files you won't find here.

## Write a story

Follow `docs/FORMAT.md`, then lint it:

    node tools/check-story/check-story.mjs stories/<your-story>

The lint needs Node 20+ and no installs. It checks the parts of the fair-play rules that a script can check: front matter, chapter recaps, short read-aloud beats, no sound-effect cues, protected names. Whether the mystery is fair still needs a human or an AI reviewer.

## Licenses

- **Stories** (`stories/`): CC BY-NC 4.0. Share and adapt with credit, not commercially. The adventures include SRD 5.2.1 material under CC BY 4.0; see `NOTICE`.
- **Docs** (`docs/`): CC BY 4.0.
- **Tools** (`tools/`): MIT.
- **Server** (`worker/`): AGPL-3.0.

The root `LICENSE` is the AGPL-3.0 text (the repository default and the server's license); each folder's own `LICENSE` governs that folder, and `NOTICE` lists them. © 2026 Volocent Labs LLC.

This repository is generated from a private working copy, so pull requests are read but changes land through the next export.
