-- Campaign resume codes (plan section 4c): a campaign is picked up in a new chat with a spoken
-- three-word code. Only its SHA-256 hash is stored, with the play it opens. Deleted with the play.
CREATE TABLE campaign_codes (
  code_hash  TEXT PRIMARY KEY,
  play_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX campaign_codes_play ON campaign_codes (play_id);
