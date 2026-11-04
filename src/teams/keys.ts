import type { RowDataPacket } from "mysql2/promise";

import { sealSecret, unsealSecret } from "@/auth/sealed-key";
import { execute, queryOne } from "@/db/client";

export type KeyProvider = "openrouter" | "higgsfield";

function pack(provider: KeyProvider, apiKey: string): string {
  return sealSecret(`${provider}\n${apiKey.trim()}`);
}

function unpack(sealed: string): { provider: KeyProvider; apiKey: string } | null {
  const plain = unsealSecret(sealed);
  if (!plain) return null;
  const split = plain.indexOf("\n");
  if (split < 1) return null;
  const provider = plain.slice(0, split);
  const apiKey = plain.slice(split + 1).trim();
  if ((provider !== "openrouter" && provider !== "higgsfield") || !apiKey) return null;
  return { provider, apiKey };
}

export async function saveTeamKey(
  teamId: number,
  userId: number,
  provider: KeyProvider,
  apiKey: string,
): Promise<void> {
  const sealed = pack(provider, apiKey);
  await execute(
    `INSERT INTO team_member_keys (team_id, user_id, provider, sealed)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE provider = VALUES(provider), sealed = VALUES(sealed)`,
    [teamId, userId, provider, sealed],
  );
}

export async function deleteTeamKey(teamId: number, userId: number): Promise<void> {
  await execute(`DELETE FROM team_member_keys WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
}

export async function hasTeamKey(teamId: number, userId: number): Promise<boolean> {
  const row = await queryOne<RowDataPacket>(
    `SELECT user_id FROM team_member_keys WHERE team_id = ? AND user_id = ?`,
    [teamId, userId],
  );
  return row !== null;
}

export async function readTeamKey(
  teamId: number,
  userId: number,
): Promise<{ provider: KeyProvider; apiKey: string } | null> {
  const row = await queryOne<RowDataPacket & { sealed: string }>(
    `SELECT sealed FROM team_member_keys WHERE team_id = ? AND user_id = ?`,
    [teamId, userId],
  );
  if (!row) return null;
  return unpack(row.sealed);
}
