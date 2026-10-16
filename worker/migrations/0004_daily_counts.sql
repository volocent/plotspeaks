-- Plot Speaks usage tallies for the admin stats (/admin/stats.json, src/stats.ts), the Volocent
-- admin dashboard and daily monitoring. Counts only: one row per (UTC day, kind, key) holding a number.
-- No cookie, IP address, user agent or play id is ever stored here (src/usage.ts).
--   kind 'page'        key = page group (home, story, passenger, connect, ...)   people's page views
--   kind 'story_page'  key = story slug                                          story page views
--   kind 'crawler'     key = page group                                          bots, previews, scripts
--   kind 'mcp'         key = requests | call:<tool> | error:<tool> | rpc_error:<method>
--                            | http_4xx | http_5xx | exception | rejected        stranger MCP traffic
--   kind 'mcp_tester'  same keys, for requests carrying the access key (smoke tests, Ben)
--   kind 'job'         key = retention | retention_error                         the daily cron
-- Rows older than 400 days are deleted by the daily retention job (src/retention.ts).
CREATE TABLE IF NOT EXISTS daily_counts (
  day   TEXT NOT NULL,
  kind  TEXT NOT NULL,
  key   TEXT NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key)
);
