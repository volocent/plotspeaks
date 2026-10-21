-- "Did it connect?" (Ben, 2026-10-20): after a visitor taps Connect to Claude or Open Gemini, the site
-- asks whether it worked. A yes is counted; a no records which problem they picked and anything they
-- typed, so the connect steps can be fixed where people get stuck. No account, no address: ip_hash is
-- the keyed hash used for the daily cap (10 a day per address, src/index.ts), as for submissions.
-- The typed note is cleared after 90 days like rating comments (src/retention.ts).
CREATE TABLE connect_feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  assistant  TEXT NOT NULL,
  outcome    TEXT NOT NULL CHECK (outcome IN ('yes', 'no')),
  issue      TEXT,
  note       TEXT,
  page       TEXT,
  ip_hash    TEXT
);
CREATE INDEX connect_feedback_at ON connect_feedback (at);
