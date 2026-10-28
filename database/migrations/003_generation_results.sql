-- Per-account gallery so a login on another device can read earlier results.
-- Review and run via: pnpm db:migrate

CREATE TABLE IF NOT EXISTS generation_results (
  user_id BIGINT UNSIGNED NOT NULL,
  client_id VARCHAR(191) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_id),
  KEY idx_generation_results_user (user_id, updated_at),
  CONSTRAINT fk_generation_results_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
