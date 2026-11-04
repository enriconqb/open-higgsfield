import { MissingCredentialsError } from "@/generation/credentials";

import { decryptApiKey } from "./crypto-key";
import { requireActiveUser } from "./guard";
import { readSession } from "./session";
import { getApiKeyRow } from "./users";

/** Decrypt the caller's API key in memory for generation. Never returns plaintext to the client. */
export async function resolveUserCredentials(): Promise<{
  apiKey: string;
  provider: "openrouter" | "higgsfield";
  /** True when the call spends the member's own key and skips team balance. */
  ownKey: boolean;
}> {
  const session = await requireActiveUser();
  const row = await getApiKeyRow(session.id);
  if (row) {
    try {
      const unlocked = decryptApiKey(row, Buffer.from(session.wrappingKey, "base64"));
      return { ...unlocked, ownKey: true };
    } catch {
      throw new Error("Could not unlock API key. Log in again and re-save the key.");
    }
  }
  const { workspaceFor } = await import("@/teams/access");
  const workspace = await workspaceFor(session);
  if (workspace.teamId) {
    const { queryOne } = await import("@/db/client");
    const owner = await queryOne<{ api_user_id: number | null } & import("mysql2/promise").RowDataPacket>(
      `SELECT api_user_id FROM teams WHERE id = ?`,
      [workspace.teamId],
    );
    if (!owner?.api_user_id) {
      throw new Error("A team admin has to choose which admin API key this team uses.");
    }
    const { readTeamKey } = await import("@/teams/keys");
    const teamKey = await readTeamKey(workspace.teamId, Number(owner.api_user_id));
    if (teamKey) return { ...teamKey, ownKey: false };
    throw new Error("The selected team API key is missing. A team admin has to choose another.");
  }
  throw new MissingCredentialsError();
}

export async function hasEncryptedPlatformKey(): Promise<boolean> {
  const session = await readSession();
  if (!session) return false;
  return (await getApiKeyRow(session.id)) !== null;
}

export async function encryptedPlatformKeyKind(): Promise<"openrouter" | "higgsfield" | null> {
  const session = await readSession();
  if (!session) return null;
  const row = await getApiKeyRow(session.id);
  return row?.provider ?? null;
}
