export const PLATFORM_KEY_COOKIE = "api_key";

export const PLATFORM_KEY_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export class MissingCredentialsError extends Error {
  constructor() {
    super("Missing platform key");
    this.name = "MissingCredentialsError";
  }
}

export type KeyProvider = "openrouter" | "higgsfield";

export type StoredCredentials = { apiKey: string; provider: KeyProvider };

export function encodeCredentials(apiKey: string, provider: KeyProvider): string {
  return JSON.stringify({ apiKey, provider });
}

export function decodeCredentials(raw: string | undefined): StoredCredentials | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const apiKey = (parsed as { apiKey?: unknown }).apiKey;
    if (typeof apiKey !== "string" || !apiKey.trim()) return null;
    const provider = (parsed as { provider?: unknown }).provider;
    return {
      apiKey: requireApiKey(apiKey.trim()),
      provider: provider === "higgsfield" ? "higgsfield" : "openrouter",
    };
  } catch {
    return null;
  }
}

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
