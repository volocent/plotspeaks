-- End-of-story feedback (Ben, 2026-10-16): besides the stars, the spoiled answer and a comment about
-- the story, the narrator asks whether the player has anything to tell the people who make Plot
-- Speaks. Free text in the player's words, up to 1000 characters; cleared after 90 days like the
-- comment (src/retention.ts). Shown on /admin/stats.json.
ALTER TABLE ratings ADD COLUMN feedback TEXT;
