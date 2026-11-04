-- Remember the workspace a user last opened, so the next login on any device opens the same one.
-- NULL is the personal workspace.
-- Review and execute manually. Do not run this from the agent.

ALTER TABLE users
  ADD COLUMN last_team_id BIGINT UNSIGNED NULL AFTER status;
