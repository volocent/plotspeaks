-- The daily board (plan 2026-10-19, item 4): one shared deal a day, and at the end the host says how
-- many have played today and the top score. One row per finished play: the day (UTC), the best
-- player's spoken first name and score. A signed-in player's replay replaces their row for the day
-- (user_id); anonymous plays each count once. Kept 400 days like daily_counts (src/retention.ts).
CREATE TABLE daily_scores (
  play_id  TEXT PRIMARY KEY,
  day      TEXT NOT NULL,
  user_id  TEXT,
  name     TEXT NOT NULL,
  score    INTEGER NOT NULL,
  at       INTEGER NOT NULL
);
CREATE INDEX daily_scores_day ON daily_scores (day, score);
