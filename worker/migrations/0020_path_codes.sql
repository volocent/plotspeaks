-- "Your path" (plan 2026-10-19, item 10): when a choose-your-path story ends, the host reads the player's
-- path and gives a three-word code. A friend says "play <story> on path <code>" and is walked through the
-- same choices, free to take another turn at any point. Only a hash of the code is stored, with the
-- choices taken (the choice texts the story already shows) and the ending's name. Kept 30 days.
CREATE TABLE path_codes (
  code_hash  TEXT PRIMARY KEY,
  story      TEXT NOT NULL,
  choices    TEXT NOT NULL,
  ending     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
