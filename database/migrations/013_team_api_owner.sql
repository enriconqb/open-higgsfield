-- Which team admin's sealed key the team uses for members without their own key.
-- Review, back up, then run manually.

ALTER TABLE teams
  ADD COLUMN api_user_id BIGINT UNSIGNED NULL AFTER billing_mode,
  ADD KEY idx_teams_api_user (api_user_id);
