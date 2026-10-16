# Solo mode

A version of each story for a driver playing alone, with no passenger to hold the answer key. The narrator gets the answer key in the same file and is told to keep it to itself until a formal accusation.

## Build

```
node tools/solo/build.mjs              # every story with story.md and secrets.md
node tools/solo/build.mjs <slug>       # one story
node --test tools/solo/test/build.test.mjs
```

Output: `dist/solo/<slug>-solo.md`. It is `story.md` with `name:` renamed to `<name>-solo`, a "Solo mode (no passenger)" section before the title, and the full `secrets.md` appended under "GM-ONLY SECRETS".

## Keep it private

The output contains the solutions. `dist/` is gitignored; do not commit it, publish it, or share it. Same rule as `secrets.md`.

## Using it

Paste `<slug>-solo.md` as the first message of a new chat instead of `story.md` (attaching it to a Project failed on ChatGPT Free: voice mode ignored the file, see docs/DECISIONS.md), and never paste `secrets.md` separately. Start with "Plot Speaks, start the story." as usual; there is no wrangler step.

## Playtesting

`node tools/playtest/playtest.mjs stories/<slug> --solo ...` runs the narrator on the solo file (building it first if missing). `--secrets` is ignored in this mode.
