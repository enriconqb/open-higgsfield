import { createHash, randomBytes } from "node:crypto";

import type { RowDataPacket } from "mysql2/promise";

import { execute, queryOne, queryRows } from "@/db/client";

export const TOKEN_PREFIX = "vic_";

export type ApiTokenScope = "read" | "generate";

export const ALL_SCOPES: readonly ApiTokenScope[] = ["read", "generate"];
export const DEFAULT_SCOPES: readonly ApiTokenScope[] = ["read", "generate"];

export type ApiTokenRow = {
  id: number;
  user_id: number;
  label: string;
  token_hash: string;
  token_hint: string;
  scopes: string;
  sealed_wrapping_key: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
};

export type PublicApiToken = {
  id: number;
  label: string;
  hint: string;
  scopes: ApiTokenScope[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  expired: boolean;
  active: boolean;
};

type TokenPacket = ApiTokenRow & RowDataPacket;

const SELECT_COLUMNS = `id, user_id, label, token_hash, token_hint, scopes, sealed_wrapping_key,
   expires_at, revoked_at, last_used_at, created_at`;

/** Only the hash is stored, so a database copy cannot be replayed as a token. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function mintToken(): { plaintext: string; hash: string; hint: string } {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plaintext, hash: hashToken(plaintext), hint: `${plaintext.slice(0, 12)}…` };
}

export function parseScopes(value: string | null | undefined): ApiTokenScope[] {
  const parts = (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ApiTokenScope => (ALL_SCOPES as readonly string[]).includes(item));
  return [...new Set(parts)];
}

export function normalizeScopes(value: unknown): ApiTokenScope[] {
  if (!Array.isArray(value)) return [...DEFAULT_SCOPES];
  const picked = value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter((item): item is ApiTokenScope => (ALL_SCOPES as readonly string[]).includes(item));
  const unique = [...new Set(picked)];
  return unique.length ? unique : [...DEFAULT_SCOPES];
}

export function isExpired(row: { expires_at: Date | null }): boolean {
  return row.expires_at !== null && row.expires_at.getTime() <= Date.now();
}

export function toPublicApiToken(row: ApiTokenRow): PublicApiToken {
  const expired = isExpired(row);
  return {
    id: row.id,
    label: row.label,
    hint: row.token_hint,
    scopes: parseScopes(row.scopes),
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    lastUsedAt: iso(row.last_used_at),
    createdAt: iso(row.created_at) ?? "",
    expired,
    active: row.revoked_at === null && !expired,
  };
}

export async function createApiToken(input: {
  userId: number;
  label: string;
  scopes: readonly ApiTokenScope[];
  expiresAt: Date | null;
  sealedWrappingKey: string;
}): Promise<{ token: string; record: PublicApiToken }> {
  const minted = mintToken();
  const result = await execute(
    `INSERT INTO api_tokens (user_id, label, token_hash, token_hint, scopes, sealed_wrapping_key, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.label.slice(0, 64),
      minted.hash,
      minted.hint.slice(0, 24),
      input.scopes.join(","),
      input.sealedWrappingKey,
      input.expiresAt,
    ],
  );
  const row = await findApiTokenById(input.userId, Number(result.insertId));
  if (!row) throw new Error("Could not create the token");
  return { token: minted.plaintext, record: toPublicApiToken(row) };
}

export async function listApiTokens(userId: number): Promise<PublicApiToken[]> {
  const rows = await queryRows<TokenPacket>(
    `SELECT ${SELECT_COLUMNS} FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
    [userId],
  );
  return rows.map(toPublicApiToken);
}

export async function findApiTokenById(userId: number, id: number): Promise<ApiTokenRow | null> {
  return queryOne<TokenPacket>(`SELECT ${SELECT_COLUMNS} FROM api_tokens WHERE id = ? AND user_id = ?`, [
    id,
    userId,
  ]);
}

export async function findApiTokenByHash(hash: string): Promise<ApiTokenRow | null> {
  return queryOne<TokenPacket>(`SELECT ${SELECT_COLUMNS} FROM api_tokens WHERE token_hash = ?`, [hash]);
}

export async function revokeApiToken(userId: number, id: number): Promise<boolean> {
  const result = await execute(
    `UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [id, userId],
  );
  return result.affectedRows > 0;
}

/** A password change rewraps the platform key, which leaves every sealed copy stale. */
export async function revokeAllApiTokens(userId: number): Promise<number> {
  const result = await execute(
    `UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );
  return result.affectedRows;
}

export async function markApiTokenUsed(id: number): Promise<void> {
  await execute(`UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
}

function iso(value: Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
