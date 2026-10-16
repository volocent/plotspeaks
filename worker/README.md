# Plot Speaks server

A stateless MCP server on a Cloudflare Worker (`createMcpHandler` from the `agents` package). Tools:

| Tool | What it does |
|---|---|
| `list_stories` | The playable stories |
| `start_story` | Serves a story script, with passenger hand-offs rewritten into tool calls |
| `reveal` | Checks one formal accusation; returns that suspect's verdict line (starts "Correct." or "Innocent.") |
| `get_cue` | An adventure cue's read-aloud text |

Answer keys are compiled into the Worker at deploy time by `tools/worker-data/build.mjs` from private `secrets.md` files, which are not in this repository. A fresh clone therefore won't build until you add your own stories with secrets.

Deploys: the top-level wrangler config is dev; production exists only as the named `prod` environment. The dev server requires an `X-PlotSpeaks-Key` header when `DEV_ACCESS_KEY` is set.

License: AGPL-3.0 (see LICENSE). If you run a modified version as a network service, you must offer its source to its users.
