-- Team workspaces: membership, invites, shared assets, sealed keys, and credit wallets.
-- Review, back up, then run manually. Do not apply from the app.

ALTER TABLE generation_results
  ADD COLUMN team_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER team_id,
  ADD KEY idx_generation_results_team (team_id, updated_at);

ALTER TABLE gallery_trash
  ADD COLUMN team_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER team_id,
  ADD KEY idx_gallery_trash_team (team_id, expires_at);

ALTER TABLE api_jobs
  ADD COLUMN team_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER team_id,
  ADD KEY idx_api_jobs_team (team_id, created_at);

ALTER TABLE usage_events
  ADD COLUMN team_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD KEY idx_usage_events_team (team_id, created_at);

ALTER TABLE api_tokens
  ADD COLUMN team_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD KEY idx_api_tokens_team (team_id);

CREATE TABLE IF NOT EXISTS teams (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  billing_mode ENUM('global', 'member') NOT NULL DEFAULT 'global',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_teams_name (name),
  KEY idx_teams_status (status),
  CONSTRAINT fk_teams_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_members (
  team_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('team_admin', 'member') NOT NULL DEFAULT 'member',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, user_id),
  KEY idx_team_members_user (user_id),
  CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_invites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  team_id BIGINT UNSIGNED NOT NULL,
  username VARCHAR(64) NOT NULL,
  invited_by BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'accepted', 'declined', 'revoked', 'expired') NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_team_invites_user (username, status),
  KEY idx_team_invites_team (team_id, status),
  CONSTRAINT fk_team_invites_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_team_invites_inviter FOREIGN KEY (invited_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  team_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  detail VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_team_audit_team (team_id, created_at),
  CONSTRAINT fk_team_audit_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_member_keys (
  team_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('openrouter', 'higgsfield') NOT NULL DEFAULT 'openrouter',
  sealed VARCHAR(2048) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_team_member_keys_member FOREIGN KEY (team_id, user_id) REFERENCES team_members (team_id, user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_credit_accounts (
  team_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  funded_credits INT UNSIGNED NOT NULL DEFAULT 0,
  remaining_credits INT UNSIGNED NOT NULL DEFAULT 0,
  held_credits INT UNSIGNED NOT NULL DEFAULT 0,
  global_cap INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_team_credit_accounts_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_member_allowances (
  team_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  limit_credits INT UNSIGNED NOT NULL DEFAULT 0,
  spent_credits INT UNSIGNED NOT NULL DEFAULT 0,
  held_credits INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_team_allowances_member FOREIGN KEY (team_id, user_id) REFERENCES team_members (team_id, user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_credit_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  team_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  actor_id BIGINT UNSIGNED NULL,
  kind VARCHAR(32) NOT NULL,
  credits INT NOT NULL DEFAULT 0,
  before_credits INT NOT NULL DEFAULT 0,
  after_credits INT NOT NULL DEFAULT 0,
  request_id VARCHAR(128) NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_team_ledger_team (team_id, created_at),
  KEY idx_team_ledger_request (team_id, request_id),
  CONSTRAINT fk_team_ledger_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_credit_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  team_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  kind ENUM('exhausted', 'member_limit', 'low') NOT NULL,
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_team_alerts_open (team_id, read_at, kind),
  CONSTRAINT fk_team_alerts_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uploads (
  id CHAR(36) NOT NULL PRIMARY KEY,
  team_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  filename VARCHAR(255) NOT NULL DEFAULT '',
  mime VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_uploads_team (team_id, created_at),
  KEY idx_uploads_owner (created_by),
  CONSTRAINT fk_uploads_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
