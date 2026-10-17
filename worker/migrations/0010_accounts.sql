-- Optional accounts, Sign in with Google (src/auth.ts). Nothing requires an account; these rows
-- exist only for people who sign in, and deleting the account removes every one of them.

-- One row per person: Google's stable account id, the verified email and display name Google gives.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT,
  name          TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

-- Site sign-in sessions. Only a SHA-256 of the cookie is stored.
CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- What a signed-in person has played and how it ended: the memory behind "something I haven't
-- played" and the account page. Kept while the account exists (not subject to the 90-day log rule).
CREATE TABLE user_history (
  user_id      TEXT NOT NULL,
  play_id      TEXT NOT NULL,
  story        TEXT NOT NULL,
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  outcome      TEXT,
  finished_at  INTEGER,
  PRIMARY KEY (user_id, play_id)
);
CREATE INDEX user_history_story ON user_history (user_id, story);

-- Trivia clues a signed-in person has heard, so the next game on that board deals new ones.
CREATE TABLE user_seen (
  user_id  TEXT NOT NULL,
  story    TEXT NOT NULL,
  clue     TEXT NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, story, clue)
);

-- A play made through the account connector belongs to its person (for campaigns and history).
ALTER TABLE plays ADD COLUMN user_id TEXT;
