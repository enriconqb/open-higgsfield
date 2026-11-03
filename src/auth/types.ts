export type UserRole = "superadmin" | "admin" | "user";
export type UserStatus = "pending" | "active" | "disabled";

/** Admin accounts use the same studio tools as a superadmin. */
export function hasStudioAdminAccess(role: UserRole): boolean {
  return role === "superadmin" || role === "admin";
}

export type PublicUser = {
  id: number;
  username: string;
  role: UserRole;
  status: UserStatus;
  /** Set on the admin user list. Absent elsewhere, so a missing value is not "no key". */
  hasApiKey?: boolean;
};

export type SessionUser = PublicUser & {
  /** Base64 AES-256 wrapping key derived from password at login. Never stored in MySQL. */
  wrappingKey: string;
};

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  password_salt: Buffer;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
};

export type ApiKeyRow = {
  user_id: number;
  provider: "openrouter" | "higgsfield";
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
};
