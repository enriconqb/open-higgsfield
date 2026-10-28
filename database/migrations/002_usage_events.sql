-- Generation usage log for the /usage dashboard.
-- Review and run via: pnpm db:migrate

CREATE TABLE IF NOT EXISTS usage_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  model_id VARCHAR(128) NOT NULL,
  kind ENUM('image', 'video') NOT NULL,
  spec VARCHAR(128) NOT NULL DEFAULT '',
  cost_usd DECIMAL(12, 6) NULL,
  credits INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usage_request (request_id),
  KEY idx_usage_user_created (user_id, created_at),
  KEY idx_usage_created (created_at),
  CONSTRAINT fk_usage_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
