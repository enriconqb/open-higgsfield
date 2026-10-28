import type { RowDataPacket } from "mysql2/promise";

import { execute, getPool, queryOne, queryRows } from "@/db/client";

import type { ApiKeyRow, PublicUser, UserRole, UserRow, UserStatus } from "./types";

type UserPacket = UserRow & RowDataPacket;
type KeyPacket = ApiKeyRow & RowDataPacket;

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  return queryOne<UserPacket>(
    `SELECT id, username, password_hash, password_salt, role, status, created_at, updated_at
     FROM users WHERE username = ? LIMIT 1`,
    [username],
  );
}

export async function findUserById(id: number): Promise<UserRow | null> {
  return queryOne<UserPacket>(
    `SELECT id, username, password_hash, password_salt, role, status, created_at, updated_at
     FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function createUser(input: {
  username: string;
  passwordHash: string;
  passwordSalt: Buffer;
  role?: UserRole;
  status?: UserStatus;
}): Promise<number> {
  const result = await execute(
    `INSERT INTO users (username, password_hash, password_salt, role, status)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.username,
      input.passwordHash,
      input.passwordSalt,
      input.role ?? "user",
      input.status ?? "pending",
    ],
  );
  return Number(result.insertId);
}

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await queryRows<UserPacket>(
    `SELECT id, username, password_hash, password_salt, role, status, created_at, updated_at
     FROM users ORDER BY created_at DESC`,
  );
  return rows.map(toPublic);
}

export async function updateUserStatus(id: number, status: UserStatus): Promise<boolean> {
  const result = await execute(`UPDATE users SET status = ? WHERE id = ? AND role = 'user'`, [
    status,
    id,
  ]);
  return result.affectedRows > 0;
}

export async function updateUserRole(id: number, role: UserRole): Promise<boolean> {
  if (role === "superadmin") {
    throw new Error("Cannot promote to superadmin");
  }
  const result = await execute(
    `UPDATE users SET role = ? WHERE id = ? AND role = 'user' AND status = 'active'`,
    [role, id],
  );
  return result.affectedRows > 0;
}

export async function changeOwnPassword(input: {
  userId: number;
  passwordHash: string;
  passwordSalt: Buffer;
  rewrapped: { provider: string; ciphertext: Buffer; iv: Buffer; authTag: Buffer } | null;
}): Promise<void> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ? AND status = 'active'`,
      [input.passwordHash, input.passwordSalt, input.userId],
    );
    if (input.rewrapped) {
      await conn.query(
        `UPDATE user_api_keys
         SET provider = ?, ciphertext = ?, iv = ?, auth_tag = ?
         WHERE user_id = ?`,
        [
          input.rewrapped.provider,
          input.rewrapped.ciphertext,
          input.rewrapped.iv,
          input.rewrapped.authTag,
          input.userId,
        ],
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function getApiKeyRow(userId: number): Promise<ApiKeyRow | null> {
  return queryOne<KeyPacket>(
    `SELECT user_id, provider, ciphertext, iv, auth_tag FROM user_api_keys WHERE user_id = ?`,
    [userId],
  );
}

export async function upsertApiKey(
  userId: number,
  data: { provider: string; ciphertext: Buffer; iv: Buffer; authTag: Buffer },
): Promise<void> {
  await execute(
    `INSERT INTO user_api_keys (user_id, provider, ciphertext, iv, auth_tag)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       provider = VALUES(provider),
       ciphertext = VALUES(ciphertext),
       iv = VALUES(iv),
       auth_tag = VALUES(auth_tag)`,
    [userId, data.provider, data.ciphertext, data.iv, data.authTag],
  );
}

export async function deleteApiKey(userId: number): Promise<void> {
  await execute(`DELETE FROM user_api_keys WHERE user_id = ?`, [userId]);
}

export function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
  };
}
