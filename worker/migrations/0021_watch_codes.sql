-- Watch a trivia game (plan 2026-10-19, item 18): a two-word code, given when a trivia game starts, opens a
-- read-only live view of the board at plotspeaks.com/play (categories left, scores, the clue just read,
-- the last ruling). It never shows an answer before it has been ruled. The code is the play's handle for
-- the viewer only; it expires after a day (src/retention.ts).
CREATE TABLE watch_codes (
  code       TEXT PRIMARY KEY,
  play_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
