-- 008: keep the original prompt and resolved settings on an API job, so a job
-- created by a bearer token can be rendered as a gallery record later without
-- guessing what the client asked for.
ALTER TABLE api_jobs ADD COLUMN prompt TEXT NULL AFTER model_id;
ALTER TABLE api_jobs ADD COLUMN settings JSON NULL AFTER prompt;
