import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { KeyProvider } from "@/generation/credentials";

const IV_LEN = 12;

export type EncryptedApiKey = {
  provider: KeyProvider;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

export function encryptApiKey(
  apiKey: string,
  provider: KeyProvider,
  wrappingKey: Buffer,
): EncryptedApiKey {
  if (wrappingKey.length !== 32) throw new Error("Invalid wrapping key");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    provider,
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
  };
}

export function decryptApiKey(
  row: { ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; provider: KeyProvider },
  wrappingKey: Buffer,
): { apiKey: string; provider: KeyProvider } {
  if (wrappingKey.length !== 32) throw new Error("Invalid wrapping key");
  const decipher = createDecipheriv("aes-256-gcm", wrappingKey, row.iv);
  decipher.setAuthTag(row.auth_tag);
  const apiKey = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
  return { apiKey, provider: row.provider };
}
