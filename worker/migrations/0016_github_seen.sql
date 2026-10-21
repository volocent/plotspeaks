-- Who follows the Volocent GitHub organisation, and who has starred, watched or forked the public repo
-- (Ben, 2026-10-20: "track when anyone follows"). GitHub has no webhook for a follow, so the daily cron
-- (src/github.ts) reads the public lists and records each login the first time it sees it. These are
-- public GitHub profiles (login names only). The first run records everyone already there at the same
-- time (the baseline); anyone later is new. Listed in /admin/stats.json. Never expired: it is a count.
CREATE TABLE github_seen (
  kind     TEXT NOT NULL CHECK (kind IN ('follower', 'star', 'watcher', 'fork')),
  login    TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  baseline INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, login)
);
