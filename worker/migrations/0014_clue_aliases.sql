-- Upheld challenges teach the board (plan 2026-10-19, item 5): when the three judges uphold a right
-- answer the board refused, the player's answer (normalised) becomes an accepted alternative for that
-- clue for everyone. clue_id is games.ts clueId (category|answer), story is the seen-key (a team's
-- board is team-trivia/<slug>). Listed in /admin/stats.json so Ben can fold the good ones into
-- secrets.md with tools/check-story/add-aliases.mjs. At most 5 per clue (index.ts).
CREATE TABLE clue_aliases (
  story    TEXT NOT NULL,
  clue_id  TEXT NOT NULL,
  alias    TEXT NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (story, clue_id, alias)
);
