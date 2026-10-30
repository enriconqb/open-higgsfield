-- 010: public preview links for one result or a timeline.
-- Review and execute manually. Do not apply this file automatically.

CREATE TABLE IF NOT EXISTS shares (
  token VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('image', 'video', 'timeline') NOT NULL,
  clips JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_shares_user (user_id, created_at),
  CONSTRAINT fk_shares_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
