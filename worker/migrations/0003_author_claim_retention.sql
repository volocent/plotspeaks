-- Plot Speaks: author credit without accounts, claim codes, passenger-page logging, and the
-- indexes the daily 90-day retention job (scheduled() in src/retention.ts) deletes by.

-- submit_story's author_name: the public "Written by" credit, self-declared (2-60 chars) and
-- checked by the human reviewer with the story. On approval it replaces metadata.author in the
-- story text served to players and the site. NULL for rows submitted before this migration.
ALTER TABLE submissions ADD COLUMN author_name TEXT;

-- The claim code is shown to the writer once; only SHA-256(id ":" code) is kept. It lets the
-- writer withdraw (withdraw_submission) or replace (submit_story with replaces_id) the story.
ALTER TABLE submissions ADD COLUMN claim_hash TEXT;

-- Which front end made a play event: NULL for the MCP tools (as before), 'passenger-page' for
-- the site's /api/stories/<slug>/check and /cue endpoints.
ALTER TABLE play_events ADD COLUMN app TEXT;

-- Retention deletes by age; without these the daily job would scan whole tables.
CREATE INDEX IF NOT EXISTS plays_started ON plays (started_at);
CREATE INDEX IF NOT EXISTS play_events_at ON play_events (at);
CREATE INDEX IF NOT EXISTS ratings_at ON ratings (at);
