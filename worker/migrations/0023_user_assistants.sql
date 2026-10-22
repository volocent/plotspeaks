-- Connected assistants follow the account (Ben, 2026-10-22): connecting your own AI is a setting of the
-- person, not of one browser. A signed-in visitor's "Connected" badges come from here on every device.
-- Rows come from the account connector being used by that assistant (the MCP client), from "Did it
-- connect? Yes", and from a browser that already had the badge; "Remove" on the site sets removed = 1,
-- and using that assistant again clears it. Deleted with the account.
CREATE TABLE user_assistants (
  user_id   TEXT NOT NULL,
  assistant TEXT NOT NULL,
  at        INTEGER NOT NULL,
  removed   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, assistant)
);
