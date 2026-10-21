-- Daily GitHub totals (src/github.ts): followers of the Volocent organisation, and the plotspeaks repo's
-- stars, watchers and forks. The lists of who (github_seen, migration 0016) are not always readable
-- without a token (GitHub answers 401 for the star and watcher lists), so the totals are the sure signal:
-- a number going up is a new follower, star, watcher or fork. One row a day; kept 400 days.
CREATE TABLE github_counts (
  day        TEXT PRIMARY KEY,
  followers  INTEGER NOT NULL,
  stars      INTEGER NOT NULL,
  watchers   INTEGER NOT NULL,
  forks      INTEGER NOT NULL
);
