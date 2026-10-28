export class MissingCredentialsError extends Error {
  constructor() {
    super("Missing platform key");
    this.name = "MissingCredentialsError";
  }
}

export type KeyProvider = "openrouter" | "higgsfield";

export type StoredCredentials = { apiKey: string; provider: KeyProvider };

export function parseCredentialInput(data: unknown): StoredCredentials {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Enter an API key");
  }
  const record = data as { apiKey?: unknown; api_key?: unknown; provider?: unknown };
  const apiKey = record.apiKey ?? record.api_key;
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Enter an API key");
  return {
    apiKey: requireApiKey(apiKey.trim()),
    provider: record.provider === "higgsfield" ? "higgsfield" : "openrouter",
  };
}

export function toAuthorizationHeader(apiKey: string, provider: KeyProvider): string {
  const key = requireApiKey(apiKey);
  return provider === "higgsfield" ? `Key ${key}` : `Bearer ${key}`;
}

function requireApiKey(apiKey: string): string {
  if (!apiKey || /\s/.test(apiKey)) throw new Error("Enter an API key");
  return apiKey;
}
