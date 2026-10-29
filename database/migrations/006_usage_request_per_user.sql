-- A request id belongs to the user who started it, not to the whole table.
--
-- uq_usage_request keyed only on request_id, while every read is scoped by
-- user_id. Two accounts that ever produce the same id (a provider retry, a
-- restored backup, a client reusing a job id) would collide: the later INSERT
-- hit ON DUPLICATE KEY UPDATE and the row stayed owned by whoever wrote first,
-- so a generation could be billed to the wrong account or vanish from the
-- owner's usage page.
--
-- Review and run via: pnpm db:migrate
-- The statements below are idempotent and order-safe: MySQL has no
-- DROP INDEX IF EXISTS, so `scripts/db-migrate.mjs` tolerates the duplicate-index
-- errors they can raise on a re-run.

ALTER TABLE usage_events ADD UNIQUE KEY uq_usage_request_user (user_id, request_id);

ALTER TABLE usage_events ADD KEY idx_usage_request (request_id);

ALTER TABLE usage_events DROP INDEX uq_usage_request;
