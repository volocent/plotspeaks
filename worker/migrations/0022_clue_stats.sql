-- Real difficulty (plan 2026-10-19, item 15). A blind model answers nearly every clue (2026-10-21: Haiku
-- averaged 2.85 of 3 on the geography board, 500s included), so it can't tell an easy clue from a hard
-- one for a person in a car. Players can: each ruling adds to the clue's count asked and count right.
-- story is the seen-key (a team's board is team-trivia/<slug>); clue_id is games.ts clueId. Counts only.
CREATE TABLE clue_stats (
  story    TEXT NOT NULL,
  clue_id  TEXT NOT NULL,
  asked    INTEGER NOT NULL DEFAULT 0,
  right    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (story, clue_id)
);
