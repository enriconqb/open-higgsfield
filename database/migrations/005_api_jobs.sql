-- Job ledger for generations started through /api/v1, so a token client can
-- poll by request id and download the bytes after the fact. The platform's own
-- status is still the source of truth for video jobs; this table keeps
-- ownership (404 for other users), idempotency, and finished image results.
-- Review and run via: pnpm db:migrate

CREATE TABLE IF NOT EXISTS api_jobs (
  request_id VARCHAR(128) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_id BIGINT UNSIGNED NULL,
  model_id VARCHAR(128) NOT NULL,
  kind ENUM('image', 'video') NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  cost_usd DECIMAL(12, 6) NULL,
  error TEXT NULL,
  result JSON NULL,
  idempotency_key VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_api_jobs_idempotency (user_id, idempotency_key),
  KEY idx_api_jobs_user (user_id, created_at),
  CONSTRAINT fk_api_jobs_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_api_jobs_token
    FOREIGN KEY (token_id) REFERENCES api_tokens (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
