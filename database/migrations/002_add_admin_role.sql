-- Add the admin role. Review, back up, then run this manually.
-- Existing values stay valid: superadmin and user.

ALTER TABLE users
  MODIFY role ENUM('superadmin', 'admin', 'user') NOT NULL DEFAULT 'user';
