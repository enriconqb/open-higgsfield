-- Soft-deleted gallery rows. Expired rows are removed by the app, with their media.
-- Review and run via: pnpm db:migrate

CREATE TABLE IF NOT EXISTS gallery_trash (
  user_id BIGINT UNSIGNED NOT NULL,
  client_id VARCHAR(191) NOT NULL,
  payload JSON NOT NULL,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  PRIMARY KEY (user_id, client_id),
  KEY idx_gallery_trash_expires (expires_at),
  CONSTRAINT fk_gallery_trash_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
