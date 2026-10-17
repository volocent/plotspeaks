-- Where a play is, for the kinds that keep state between tool calls (plan section 4): a
-- choose-your-path story's current node, flags and path today; a game's board and scores, and a
-- campaign's world, later. One row per play, JSON in "state" (capped by the code at 32 KB).
-- Deleted with its play at 90 days (src/retention.ts). No personal data: node ids, flags and the
-- text of the choices the server offered.
CREATE TABLE play_state (
  play_id     TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  state       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX play_state_updated ON play_state (updated_at);
