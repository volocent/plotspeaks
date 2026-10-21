-- A tester's verdict on a story that is still being tested (Ben, 2026-10-17): at the end of a
-- "being tested" story the narrator asks whether it passed the player's test or needs work, and
-- rate_story records it here, with any suggestion in the player's words. Any player can give one,
-- signed in or not; one per play. Its own table because ratings.stars is NOT NULL and a verdict may
-- come without stars. Shown on /admin/stats.json; the count of passes shows on the story's page.
-- Suggestions are cleared after 90 days like rating comments (src/retention.ts).
CREATE TABLE test_verdicts (
  play_id   TEXT PRIMARY KEY,
  story     TEXT NOT NULL,
  verdict   TEXT NOT NULL CHECK (verdict IN ('passed', 'needs_work')),
  feedback  TEXT,
  at        INTEGER NOT NULL,
  tester    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX test_verdicts_story ON test_verdicts (story, at);
