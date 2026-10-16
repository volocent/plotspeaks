# Plot Speaks server

A stateless MCP server on a Cloudflare Worker (`createMcpHandler` from the `agents` package). Tools:

| Tool | What it does |
|---|---|
| `list_stories` | The playable stories |
| `start_story` | Serves a story script, with passenger hand-offs rewritten into tool calls |
| `reveal` | Checks one formal accusation; returns that suspect's verdict line (starts "Correct." or "Innocent.") |
| `get_cue` | An adventure cue: text to narrate, plus narrator-only notes never read aloud |
| `rate_story` | Saves a 1-5 star rating, whether anything was given away early, and an optional comment |

Answer keys are compiled into the Worker at deploy time by `tools/worker-data/build.mjs` from private `secrets.md` files, which are not in this repository. A fresh clone therefore won't build until you add your own stories with secrets.

Play data goes to a D1 database (`migrations/`): plays, accusations, verdicts, cues and ratings. No transcripts, names or IP addresses are stored. `scripts/stats.mjs` prints the totals, and `test/smoke.mjs` checks every tool.

Deploys: the top-level wrangler config is dev; production exists only as the named `prod` environment. When `DEV_ACCESS_KEY` is set, tool calls need that key as `X-API-Key` or `Authorization: Bearer <key>`; the handshake and tool list stay open so clients can detect that there is no sign-in.

License: AGPL-3.0 (see LICENSE). If you run a modified version as a network service, you must offer its source to its users.
