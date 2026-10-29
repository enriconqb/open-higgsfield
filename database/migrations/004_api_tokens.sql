-- Per-user API tokens so external clients (OpenMontage and friends) can call
-- Vicend without a login form. The owner's password-derived wrapping key is
-- sealed with SESSION_SECRET and kept on the row, so a token can unlock the
-- stored platform key while it stays valid. Only the SHA-256 hash is stored.
-- Review and run via: pnpm db:migrate

CREATE TABLE IF NOT EXISTS api_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(64) NOT NULL DEFAULT '',
  token_hash CHAR(64) NOT NULL,
  token_hint VARCHAR(24) NOT NULL DEFAULT '',
  scopes VARCHAR(128) NOT NULL DEFAULT 'read,generate',
  sealed_wrapping_key VARCHAR(512) NOT NULL,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  last_used_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_api_tokens_hash (token_hash),
  KEY idx_api_tokens_user (user_id, created_at),
  CONSTRAINT fk_api_tokens_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
