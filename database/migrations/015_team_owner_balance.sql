-- Saldo per admin yang pernah dipilih sebagai Team API.
-- Review, backup, lalu jalankan manual. Jangan dijalankan otomatis.

CREATE TABLE IF NOT EXISTS team_owner_balances (
  team_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  funded_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  remaining_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  held_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  billing_mode ENUM('global', 'member') NOT NULL DEFAULT 'global',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_team_owner_balances_member FOREIGN KEY (team_id, user_id) REFERENCES team_members (team_id, user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO team_owner_balances (team_id, user_id, funded_usd, remaining_usd, held_usd, billing_mode)
SELECT t.id, t.api_user_id, a.funded_usd, a.remaining_usd, a.held_usd, t.billing_mode
FROM teams t
INNER JOIN team_credit_accounts a ON a.team_id = t.id
WHERE t.api_user_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  funded_usd = VALUES(funded_usd),
  remaining_usd = VALUES(remaining_usd),
  held_usd = VALUES(held_usd),
  billing_mode = VALUES(billing_mode);
