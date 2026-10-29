-- Which token started a job.
--
-- A request id already carries its owner, but a user can hold several tokens
-- (one per tool). Keeping the token id on the row lets /api/v1/usage answer
-- "what did this token do" without guessing, and lets a user notice a tool they
-- no longer want running. Browser sessions write NULL.
--
-- Review and run via: pnpm db:migrate
-- Idempotent: the unique index and the drop are tolerated on a re-run.

ALTER TABLE usage_events ADD COLUMN token_id BIGINT UNSIGNED NULL AFTER user_id;

ALTER TABLE usage_events ADD KEY idx_usage_token_created (token_id, created_at);

ALTER TABLE usage_events
  ADD CONSTRAINT fk_usage_token
  FOREIGN KEY (token_id) REFERENCES api_tokens (id)
  ON DELETE SET NULL;
