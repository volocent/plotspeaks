-- Plot Speaks story submissions (Phase 2, M5). The review queue lives here, not in GitHub:
-- submit_story stores a row as 'pending'; nothing is public until Ben approves it on the
-- key-gated /admin/submissions page. No raw IP address is ever stored, only a keyed hash.

CREATE TABLE submissions (
  id                TEXT PRIMARY KEY,
  created_at        INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  title             TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  genre             TEXT,
  players           TEXT,
  duration_minutes  INTEGER,
  story_md          TEXT NOT NULL,
  secrets_md        TEXT,
  contact           TEXT,
  moderation        TEXT NOT NULL,   -- JSON: Llama Guard verdict per file
  lint              TEXT NOT NULL,   -- check_story summary line + counts
  cover             BLOB,
  cover_type        TEXT,
  cover_prompt      TEXT,
  ip_hash           TEXT NOT NULL,
  dev_marker        INTEGER NOT NULL DEFAULT 0,   -- 1 = made by the smoke test; safe to delete
  reviewed_at       INTEGER
);
CREATE INDEX submissions_status ON submissions (status, created_at);

-- Every submit_story call that reaches the AI screener counts toward the per-IP (3/day) and
-- site-wide daily caps, whether or not it was stored, so refused drafts can't burn the
-- Workers AI allowance either.
CREATE TABLE submission_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash        TEXT NOT NULL,
  at             INTEGER NOT NULL,
  outcome        TEXT NOT NULL,     -- stored | refused | error
  submission_id  TEXT
);
CREATE INDEX submission_attempts_ip ON submission_attempts (ip_hash, at);
CREATE INDEX submission_attempts_at ON submission_attempts (at);
