-- Permanent running totals that survive the 90-day play-log retention (2026-10-16).
-- Gate 2 (500 completed plays by strangers) can take longer than 90 days, but play rows are deleted
-- after 90, so the count would drop. One row per counter; numbers only, nothing personal.
--   completed_stranger_plays: +1 the first time a stranger's play reaches an accusation or a rating.
CREATE TABLE IF NOT EXISTS totals (
  key TEXT PRIMARY KEY,
  n   INTEGER NOT NULL DEFAULT 0
);
-- Start from what the play log still holds.
INSERT OR IGNORE INTO totals (key, n)
SELECT 'completed_stranger_plays', count(*) FROM plays p
WHERE p.tester = 0
  AND (EXISTS (SELECT 1 FROM play_events e WHERE e.play_id = p.id AND e.kind = 'accusation')
       OR EXISTS (SELECT 1 FROM ratings r WHERE r.play_id = p.id));
