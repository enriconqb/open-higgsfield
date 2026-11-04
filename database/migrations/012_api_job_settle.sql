-- 012: let the server follow a studio generation on its own, so closing the
-- browser (or the whole PC) neither loses the result nor leaves the run
-- running forever.
--
-- `sealed_credentials` is the platform key of the account that submitted the
-- job, sealed with SESSION_SECRET through the same envelope api_tokens already
-- uses for `sealed_wrapping_key`. It exists only while the job is in flight and
-- is cleared the moment the job reaches a terminal state, so a browser that is
-- never opened again cannot strand a run. NULL means "this job is followed by
-- its own client" — every /api/v1 row stays NULL and is untouched by the worker.
--
-- `attempts` counts consecutive polls that could not reach the platform, so a
-- job whose request id vanished upstream ends as failed instead of pending
-- forever.
-- Review and run via: pnpm db:migrate

ALTER TABLE api_jobs ADD COLUMN sealed_credentials TEXT NULL AFTER result;
ALTER TABLE api_jobs ADD COLUMN attempts INT NOT NULL DEFAULT 0 AFTER sealed_credentials;
