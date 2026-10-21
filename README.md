# Plot Speaks

Interactive story scripts you play by voice with your own AI assistant: murder mysteries first, fantasy adventures second. One narrator, short spoken turns, built for long drives. A Volocent Labs project.

**Status: early.** Play at **https://plotspeaks.com**: copy a story into a new ChatGPT or Claude chat, or add the Plot Speaks connector (`https://plotspeaks.com/mcp`, no sign-in), which loads stories and checks accusations so your assistant never holds the answer. The story format, the published stories and the tools that test them are here.

## How it works

![Plot Speaks technical design: players and their assistants, the Cloudflare Worker with its game engines, storage and services, and the write, check, build and ship pipeline](docs/architecture.svg)

The assistant narrates; the server keeps every answer key and decides every verdict. The diagram source is `docs/architecture.svg`.

## What's here

```
stories/        the published stories (murder mysteries, family mysteries, SRD adventures); catalog.json lists them
docs/FORMAT.md  the story format: front matter, GM instructions, scenes, recaps, endings
docs/PLAY.md    how to play a story today
docs/architecture.svg  the technical design of the whole solution
tools/          check-story (lint), playtest (simulated play), solo, worker-data (connector build and matching)
worker/         the Plot Speaks MCP server (Cloudflare Worker)
```

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

Details are in `LICENSE`. © 2026 Volocent Labs LLC.

This repository is generated from a private working copy, so pull requests are read but changes land through the next export.
