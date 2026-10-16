-- Design review 2026-10-16, S3 and S4.
--
-- S3: ratings.tester marks ratings from tester plays (made with the access key, and the deploy
-- smoke test's). They are kept for us but left out of the site's public averages and the stats.
-- rate_story now needs the play id of a play that exists, and keeps one rating per play.
ALTER TABLE ratings ADD COLUMN tester INTEGER NOT NULL DEFAULT 0;
UPDATE ratings SET tester = 1
WHERE comment = 'smoke test'
   OR play_id IN (SELECT id FROM plays WHERE tester = 1);
CREATE INDEX IF NOT EXISTS ratings_play ON ratings (play_id);

-- S4: one row per play that counted toward Gate 2 (completed_stranger_plays in totals). The
-- primary key makes the count idempotent: a retried or concurrent check_accusation, rating or
-- reveal for the same play inserts nothing, and the totals bump only follows an insert made by
-- the same request (matched by its random nonce). Play ids are random; nothing personal here.
CREATE TABLE IF NOT EXISTS completions (
  play_id  TEXT PRIMARY KEY,
  at       INTEGER NOT NULL,
  nonce    TEXT NOT NULL
);
-- Plays already counted before this table existed, so they can't be counted twice.
INSERT OR IGNORE INTO completions (play_id, at, nonce)
SELECT p.id, p.started_at, 'seed' FROM plays p
WHERE p.tester = 0
  AND (EXISTS (SELECT 1 FROM play_events e WHERE e.play_id = p.id AND e.kind = 'accusation')
       OR EXISTS (SELECT 1 FROM ratings r WHERE r.play_id = p.id));
