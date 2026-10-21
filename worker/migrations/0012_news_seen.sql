-- "What's new" on open (plan 2026-10-19, item 6): open_plot_speaks reads a signed-in player one line
-- per change they haven't heard, from stories/whats-new.json, and records the newest id here so the
-- same line is never read twice. Anonymous callers hear only the newest line. NULL: never told.
ALTER TABLE users ADD COLUMN news_seen TEXT;
