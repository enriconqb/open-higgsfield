-- Initial auth schema: users, encrypted API keys, migration ledger.
-- Review and run via: pnpm db:migrate

CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_salt VARBINARY(32) NOT NULL,
  role ENUM('superadmin', 'user') NOT NULL DEFAULT 'user',
  status ENUM('pending', 'active', 'disabled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_status (status),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  provider ENUM('openrouter', 'higgsfield') NOT NULL DEFAULT 'openrouter',
  ciphertext VARBINARY(1024) NOT NULL,
  iv VARBINARY(12) NOT NULL,
  auth_tag VARBINARY(16) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_api_keys_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
