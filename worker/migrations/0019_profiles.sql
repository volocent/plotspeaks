-- Profiles (plan 2026-10-19, items 8 and 9; Ben: the public share page is in). A signed-in player can
-- choose a handle and make a public page at /p/<handle> showing only badges and game stats (no history,
-- no email, no name). public = 0 until they switch it on. The handle is unique and screened
-- (src/profile.ts). Deleted with the account.
ALTER TABLE users ADD COLUMN handle TEXT;
ALTER TABLE users ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX users_handle ON users (handle) WHERE handle IS NOT NULL;
