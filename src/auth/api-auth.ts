import { originOf, type GenerationContext } from "@/generation/engine";

import {
  TOKEN_PREFIX,
  findApiTokenByHash,
  findApiTokenById,
  hashToken,
  markApiTokenUsed,
  parseScopes,
  type ApiTokenScope,
} from "./api-tokens";
import { decryptApiKey } from "./crypto-key";
import { unsealSecret } from "./sealed-key";
import type { UserRole } from "./types";
import { findUserById, getApiKeyRow } from "./users";

/** Anything the JSON API should answer with a status code instead of a stack trace. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
  }
}

export type ApiIdentity = {
  userId: number;
  username: string;
  role: UserRole;
  tokenId: number;
  tokenLabel: string;
  scopes: ApiTokenScope[];
  expiresAt: Date | null;
};

/** Everything a generation needs, plus who the bearer token says is asking. */
export type ApiContext = GenerationContext & { identity: ApiIdentity };

const BEARER = /^Bearer\s+(\S+)$/i;

export function bearerTokenOf(request: Request): string {
  const header = (request.headers.get("authorization") ?? "").trim();
  const token = BEARER.exec(header)?.[1] ?? "";
  if (!token) throw new ApiError(401, "Send the token as: Authorization: Bearer <token>");
  if (!token.startsWith(TOKEN_PREFIX)) throw new ApiError(401, "Invalid token");
  return token;
}

/** Who is calling: token row, owner, scopes, expiry. Touches no platform key, so
    /me and /models still answer when the stored key is stale. */
export async function requireApiIdentity(
  request: Request,
  scope: ApiTokenScope = "read",
): Promise<ApiIdentity> {
  const raw = bearerTokenOf(request);
  const row = await findApiTokenByHash(hashToken(raw));
  if (!row) throw new ApiError(401, "Invalid token");
  if (row.revoked_at) throw new ApiError(401, "Token has been revoked");
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
    throw new ApiError(401, "Token has expired");
  }

  const user = await findUserById(row.user_id);
  if (!user) throw new ApiError(401, "Invalid token");
  if (user.status !== "active") throw new ApiError(403, "Account is not active");

  const scopes = parseScopes(row.scopes);
  if (!scopes.includes(scope)) throw new ApiError(403, `Token is missing the "${scope}" scope`);

  void markApiTokenUsed(row.id).catch(() => {});

  return {
    userId: row.user_id,
    username: user.username,
    role: user.role,
    tokenId: row.id,
    tokenLabel: row.label,
    scopes,
    expiresAt: row.expires_at,
  };
}

export type ApiCredentials = GenerationContext["credentials"];

/** The platform key the token is allowed to spend. 409 means the token exists but
    nothing can be unlocked with it — the client must fix the account, not retry. */
export async function requireApiCredentials(identity: ApiIdentity): Promise<ApiCredentials> {
  const row = await findApiTokenById(identity.userId, identity.tokenId);
  if (!row) throw new ApiError(401, "Invalid token");

  const wrapping = unsealSecret(row.sealed_wrapping_key);
  if (!wrapping) {
    throw new ApiError(409, "This token cannot unlock the saved platform key. Create a new token.");
  }
  const keyRow = await getApiKeyRow(identity.userId);
  if (!keyRow) {
    throw new ApiError(409, "No platform key saved for this account. Add one in Vicend, then retry.");
  }

  try {
    const decrypted = decryptApiKey(keyRow, Buffer.from(wrapping, "base64"));
    if (decrypted.provider === "higgsfield") {
      const baseUrl = process.env.HF_API_BASE_URL?.trim();
      if (!baseUrl) throw new Error("Missing HF_API_BASE_URL");
      return { apiKey: decrypted.apiKey, baseUrl, provider: "higgsfield" };
    }
    const baseUrl = (process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1").replace(/\/$/, "");
    return { apiKey: decrypted.apiKey, baseUrl, provider: "openrouter" };
  } catch (caught) {
    if (caught instanceof Error && caught.message === "Missing HF_API_BASE_URL") {
      throw new ApiError(409, "Server is missing HF_API_BASE_URL");
    }
    throw new ApiError(
      409,
      "Stored key no longer matches this token. Create a new token and try again.",
    );
  }
}

export async function requireApiContext(
  request: Request,
  scope: ApiTokenScope = "read",
): Promise<ApiContext> {
  const identity = await requireApiIdentity(request, scope);
  const credentials = await requireApiCredentials(identity);
  return { userId: identity.userId, credentials, origin: originOf(request), identity };
}
