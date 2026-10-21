-- Head-to-head by code (plan 2026-10-19, item 7): when a board-mode trivia game ends, the host gives the
-- player a three-word code. A friend says "play against <code>" and gets the same board dealt the same
-- way; at the end the host compares the two top scores. Nothing live: the friend plays whenever they like.
-- Only a hash of the code is stored (like campaign_codes), with the deal, the top score and the first name
-- the player gave. Kept 30 days (src/retention.ts).
CREATE TABLE board_codes (
  code_hash  TEXT PRIMARY KEY,
  story      TEXT NOT NULL,
  seed       TEXT NOT NULL,
  name       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  play_id    TEXT,
  created_at INTEGER NOT NULL
);
