-- Plot Speaks play data (Phase 2, M2). What Gate 2 needs and nothing more: no transcripts,
-- no player names, no IP addresses.

-- One row per start_story call. "client" is the User-Agent the assistant's connector sends
-- (e.g. "claude-user", "openai-mcp/1.0.0"; first 80 characters), used to split counts by
-- assistant; "tester" marks plays made on the dev server or with the prod tester key, so Gate 2
-- can count strangers only.
CREATE TABLE plays (
  id          TEXT PRIMARY KEY,
  story       TEXT NOT NULL,
  client      TEXT,
  tester      INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL
);

-- Accusations, verdicts, reveals and cues within a play (kind: accusation | reveal | cue; the MCP
-- get_cue tool records nothing, so cue rows come from the passenger page only).
CREATE TABLE play_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id   TEXT,
  story     TEXT NOT NULL,
  kind      TEXT NOT NULL,
  detail    TEXT,
  verdict   TEXT,
  at        INTEGER NOT NULL
);
CREATE INDEX play_events_play ON play_events (play_id);

-- rate_story. A play counts as "completed" for Gate 2 if it reached a verdict or a rating.
CREATE TABLE ratings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id   TEXT,
  story     TEXT NOT NULL,
  stars     INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  spoiled   INTEGER,
  comment   TEXT,
  at        INTEGER NOT NULL
);
CREATE INDEX ratings_story ON ratings (story);
