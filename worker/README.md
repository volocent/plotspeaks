# Plot Speaks server

A stateless MCP server on a Cloudflare Worker (`createMcpHandler` from the `agents` package). Tools:

| Tool | What it does |
|---|---|
| `open_plot_speaks` | A spoken intro, a question and a menu of story categories |
| `list_stories` | The playable stories |
| `start_story` | Serves a story's connector script (built at deploy time with the paste-play hand-offs rewritten into tool calls; two-chapter stories one chapter at a time) and a play id |
| `check_accusation` | Checks one formal accusation; returns that suspect's verdict line (starts "Correct." or "Innocent.") and the name it matched |
| `reveal_solution` | The full solution and what became of each character, only after an accusation or when the player gives up |
| `get_cue` | An adventure cue: text to narrate, plus narrator notes never read aloud |
| `rate_story` | Saves a 1-5 star rating for a play, whether anything was given away early, and an optional comment |
| `write_story` | Story Studio: the format template and a suggested way to draft a story with the writer |
| `review_story` | Story Studio: lints a draft with the rules in `tools/check-story/rules.mjs` (plus the answer-key checks when `secrets_md` is given) and adds a fair-play checklist. Nothing submitted is stored or logged, only counts |
| `submit_story`, `withdraw_submission` | Story Studio: send a story for human review, or withdraw it with its claim code |

Answer keys are compiled into the Worker at deploy time by `tools/worker-data/build.mjs` from private `secrets.md` files, which are not in this repository. A fresh clone therefore won't build until you add your own stories with secrets.

Play data goes to a D1 database (`migrations/`): plays, accusations, verdicts, reveals and ratings. No transcripts, names or IP addresses are stored. `scripts/stats.mjs` prints the totals, and `test/smoke.mjs` checks every tool.

Deploys: the top-level wrangler config is dev; production exists only as the named `prod` environment. When `DEV_ACCESS_KEY` is set, tool calls need that key as `X-API-Key` or `Authorization: Bearer <key>`; the handshake and tool list stay open so clients can detect that there is no sign-in.

License: AGPL-3.0 (see LICENSE). If you run a modified version as a network service, you must offer its source to its users.
