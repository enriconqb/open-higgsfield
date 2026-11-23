-- Add audio to generation kind enums (TTS surface).
-- Review and run via: pnpm db:migrate

ALTER TABLE api_jobs
  MODIFY kind ENUM('image', 'video', 'audio') NOT NULL;

ALTER TABLE usage_events
  MODIFY kind ENUM('image', 'video', 'audio') NOT NULL;

ALTER TABLE shares
  MODIFY kind ENUM('image', 'video', 'timeline', 'audio') NOT NULL;
