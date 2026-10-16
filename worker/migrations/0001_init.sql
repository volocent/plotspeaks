-- Plot Speaks play data (Phase 2, M2). What Gate 2 needs and nothing more: no transcripts,
-- no player names, no IP addresses.

-- One row per start_story call. "client" is the MCP client name the assistant reports
-- (e.g. "claude-ai"), used to split counts by assistant; "tester" marks plays made with the
-- dev access key, so Gate 2 can count strangers only.
CREATE TABLE plays (
  id          TEXT PRIMARY KEY,
  story       TEXT NOT NULL,
  client      TEXT,
  tester      INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL
);

-- Accusations, verdicts and cues within a play (kind: accusation | cue).
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
