-- Team balance is dollars, not credits.
-- Existing integers were cents (1 credit = $0.01). Review, back up, then run manually.

ALTER TABLE team_credit_accounts
  CHANGE funded_credits funded_usd DECIMAL(12, 2) NOT NULL DEFAULT 0,
  CHANGE remaining_credits remaining_usd DECIMAL(12, 2) NOT NULL DEFAULT 0,
  CHANGE held_credits held_usd DECIMAL(12, 2) NOT NULL DEFAULT 0,
  CHANGE global_cap cap_usd DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE team_credit_accounts
SET funded_usd = funded_usd / 100,
    remaining_usd = remaining_usd / 100,
    held_usd = held_usd / 100,
    cap_usd = cap_usd / 100;

ALTER TABLE team_member_allowances
  CHANGE limit_credits limit_usd DECIMAL(12, 2) NOT NULL DEFAULT 0,
  CHANGE spent_credits spent_usd DECIMAL(12, 2) NOT NULL DEFAULT 0,
  CHANGE held_credits held_usd DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE team_member_allowances
SET limit_usd = limit_usd / 100,
    spent_usd = spent_usd / 100,
    held_usd = held_usd / 100;

ALTER TABLE team_credit_ledger
  CHANGE credits amount_usd DECIMAL(12, 2) NOT NULL DEFAULT 0,
  CHANGE before_credits before_usd DECIMAL(12, 2) NOT NULL DEFAULT 0,
  CHANGE after_credits after_usd DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE team_credit_ledger
SET amount_usd = amount_usd / 100,
    before_usd = before_usd / 100,
    after_usd = after_usd / 100;
