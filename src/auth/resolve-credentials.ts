import { MissingCredentialsError } from "@/generation/credentials";

import { decryptApiKey } from "./crypto-key";
import { requireActiveUser } from "./guard";
import { readSession } from "./session";
import { getApiKeyRow } from "./users";

/** Decrypt the caller's API key in memory for generation. Never returns plaintext to the client. */
export async function resolveUserCredentials(): Promise<{
  apiKey: string;
  provider: "openrouter" | "higgsfield";
}> {
  const session = await requireActiveUser();
  const row = await getApiKeyRow(session.id);
  if (!row) throw new MissingCredentialsError();
  try {
    return decryptApiKey(row, Buffer.from(session.wrappingKey, "base64"));
  } catch {
    throw new Error("Could not unlock API key. Log in again and re-save the key.");
  }
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
