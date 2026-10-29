"use server";

import { headers } from "next/headers";

import { withBasePath } from "@/base-path";
import { modelsFor } from "@/generation/catalog";

import {
  createApiToken,
  listApiTokens,
  normalizeScopes,
  revokeAllApiTokens,
  revokeApiToken,
  type PublicApiToken,
} from "./api-tokens";
import { decryptApiKey, encryptApiKey } from "./crypto-key";
import { requireActiveUser, requireSuperadmin } from "./guard";
import { sealSecret } from "./sealed-key";
import {
  createPasswordSalt,
  deriveWrappingKey,
  hashPassword,
  requirePassword,
  requireUsername,
  verifyPassword,
} from "./password";
import { clearSession, readSession, writeSession } from "./session";
import type { PublicUser, SessionUser, UserStatus } from "./types";
import {
  changeOwnPassword,
  createUser,
  deleteApiKey,
  deleteUser,
  findUserById,
  findUserByUsername,
  getApiKeyRow,
  listUsers,
  toPublic,
  updateUserStatus,
  upsertApiKey,
} from "./users";

export type AuthState = {
  user: PublicUser | null;
  hasApiKey: boolean;
};

export async function getAuthState(): Promise<AuthState> {
  const session = await readSession();
  if (!session) return { user: null, hasApiKey: false };
  const key = await getApiKeyRow(session.id);
  return {
    user: {
      id: session.id,
      username: session.username,
      role: session.role,
      status: session.status,
    },
    hasApiKey: key !== null,
  };
}

export async function registerAccount(data: unknown): Promise<{ message: string }> {
  const body = asObject(data);
  const username = requireUsername(body.username);
  const password = requirePassword(body.password);

  const existing = await findUserByUsername(username);
  if (existing) throw new Error("Username is already taken");

  const passwordHash = await hashPassword(password);
  const passwordSalt = createPasswordSalt();
  await createUser({
    username,
    passwordHash,
    passwordSalt,
    role: "user",
    status: "pending",
  });

  return {
    message: "Registration received. Wait for a superadmin to approve your account before logging in.",
  };
}

export async function loginAccount(data: unknown): Promise<AuthState> {
  const body = asObject(data);
  const username = requireUsername(body.username);
  const password = requirePassword(body.password);

  const user = await findUserByUsername(username);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new Error("Invalid username or password");
  }
  if (user.status === "pending") {
    throw new Error("Account is waiting for superadmin approval");
  }
  if (user.status === "disabled") {
    throw new Error("Account is disabled");
  }

  const wrappingKey = await deriveWrappingKey(password, user.password_salt);
  const session: SessionUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    wrappingKey: wrappingKey.toString("base64"),
  };
  await writeSession(session);

  const key = await getApiKeyRow(user.id);
  return { user: toPublic(user), hasApiKey: key !== null };
}

export async function logoutAccount(): Promise<void> {
  await clearSession();
}

export async function adminListUsers(): Promise<PublicUser[]> {
  await requireSuperadmin();
  return listUsers();
}

export async function adminSetUserStatus(data: unknown): Promise<PublicUser[]> {
  const admin = await requireSuperadmin();
  const body = asObject(data);
  const id = Number(body.id);
  const status = body.status;
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid user");
  if (status !== "pending" && status !== "active" && status !== "disabled") {
    throw new Error("Invalid status");
  }
  if (id === admin.id) throw new Error("Cannot change your own status");

  const target = await findUserById(id);
  if (!target) throw new Error("User not found");
  if (target.role === "superadmin") throw new Error("Cannot change superadmin status");

  const ok = await updateUserStatus(id, status as UserStatus);
  if (!ok) throw new Error("Could not update user");
  return listUsers();
}

export async function adminCreateUser(data: unknown): Promise<PublicUser[]> {
  await requireSuperadmin();
  const body = asObject(data);
  const username = requireUsername(body.username);
  const password = requirePassword(body.password);
  const existing = await findUserByUsername(username);
  if (existing) throw new Error("Username is already taken");
  await createUser({
    username,
    passwordHash: await hashPassword(password),
    passwordSalt: createPasswordSalt(),
    role: "user",
    status: "active",
  });
  return listUsers();
}

export async function adminDeleteUser(data: unknown): Promise<PublicUser[]> {
  const admin = await requireSuperadmin();
  const body = asObject(data);
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid user");
  if (id === admin.id) throw new Error("Cannot delete your own account");
  const target = await findUserById(id);
  if (!target) throw new Error("User not found");
  if (target.role === "superadmin") throw new Error("Cannot delete a superadmin");
  const ok = await deleteUser(id);
  if (!ok) throw new Error("Could not delete user");
  return listUsers();
}

export async function saveEncryptedPlatformKey(data: unknown): Promise<AuthState> {
  const session = await requireActiveUser();
  const body = asObject(data);
  const apiKey = body.apiKey ?? body.api_key;
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Enter an API key");
  if (/\s/.test(apiKey.trim())) throw new Error("Enter an API key");
  const provider = body.provider === "higgsfield" ? "higgsfield" : "openrouter";

  const wrappingKey = Buffer.from(session.wrappingKey, "base64");
  const encrypted = encryptApiKey(apiKey.trim(), provider, wrappingKey);
  await upsertApiKey(session.id, {
    provider: encrypted.provider,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  });

  return {
    user: {
      id: session.id,
      username: session.username,
      role: session.role,
      status: session.status,
    },
    hasApiKey: true,
  };
}

export async function changePassword(data: unknown): Promise<{ message: string }> {
  const session = await requireActiveUser();
  const body = asObject(data);
  const currentPassword = requirePassword(body.currentPassword);
  const nextPassword = requirePassword(body.nextPassword);
  if (currentPassword === nextPassword) {
    throw new Error("New password must be different");
  }

  const user = await findUserById(session.id);
  if (!user || user.status !== "active") throw new Error("Account is not active");
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new Error("Current password is incorrect");
  }

  const oldWrap = await deriveWrappingKey(currentPassword, user.password_salt);
  const passwordSalt = createPasswordSalt();
  const passwordHash = await hashPassword(nextPassword);
  const newWrap = await deriveWrappingKey(nextPassword, passwordSalt);

  const row = await getApiKeyRow(session.id);
  let rewrapped: {
    provider: string;
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
  } | null = null;
  if (row) {
    let plain: ReturnType<typeof decryptApiKey>;
    try {
      plain = decryptApiKey(row, oldWrap);
    } catch {
      throw new Error("Could not unlock the saved API key. Re-save the key, then change the password.");
    }
    const encrypted = encryptApiKey(plain.apiKey, plain.provider, newWrap);
    rewrapped = {
      provider: encrypted.provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    };
  }

  await changeOwnPassword({
    userId: session.id,
    passwordHash,
    passwordSalt,
    rewrapped,
  });

  await writeSession({
    id: session.id,
    username: session.username,
    role: session.role,
    status: session.status,
    wrappingKey: newWrap.toString("base64"),
  });

  /** Every token holds a copy of the old wrapping key, which the new password
      just made useless. Revoking is honest: the client sees 401, not a mystery. */
  const revoked = await revokeAllApiTokens(session.id);

  return {
    message: revoked
      ? `Password updated. ${revoked} API token(s) revoked — create a new one for OpenMontage.`
      : "Password updated.",
  };
}

export type CreatedApiToken = {
  token: string;
  record: PublicApiToken;
  tokens: PublicApiToken[];
};

export type PublicApiInfo = {
  /** Absolute API root, e.g. http://192.168.1.100/video-gen/api/v1 */
  apiBase: string;
  appBase: string;
  playbackBase: string;
  models: { image: string; video: string } | null;
};

/** Safe without a session: the door and the menu, never a key. The base URL is
    derived from the host that is already in the visitor's address bar. */
export async function getPublicApiInfo(): Promise<PublicApiInfo> {
  const appBase = await requestBase();
  return {
    apiBase: `${appBase}${withBasePath("/api/v1")}`,
    appBase: appBase || withBasePath("/"),
    playbackBase: appBase || "",
    models: publicModelHints(),
  };
}

async function requestBase(): Promise<string> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  if (!host) return "";
  const proto = incoming.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** First model of each surface, so the page can show a real example without a token. */
function publicModelHints(): { image: string; video: string } | null {
  try {
    const entries = modelsFor("openrouter");
    const pick = (surface: "image" | "video") => {
      const studio = entries.find((entry) => entry.surface === surface && !entry.id.startsWith("or-"));
      return (studio ?? entries.find((entry) => entry.surface === surface))?.id ?? "";
    };
    const image = pick("image");
    const video = pick("video");
    return image && video ? { image, video } : null;
  } catch {
    return null;
  }
}

export async function listApiTokensAction(): Promise<PublicApiToken[]> {
  const session = await requireActiveUser();
  return listApiTokens(session.id);
}

/** Returns the plaintext once; only its SHA-256 hash is stored afterwards. */
export async function createApiTokenAction(data: unknown): Promise<CreatedApiToken> {
  const session = await requireActiveUser();
  const body = asObject(data);
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 64) : "";
  const days = Number(body.expiresInDays ?? 0);
  const expiresAt =
    Number.isFinite(days) && days > 0 ? new Date(Date.now() + Math.min(days, 3650) * 86_400_000) : null;
  const wrappingKey = Buffer.from(session.wrappingKey, "base64");
  if (wrappingKey.length !== 32) throw new Error("Session key is unusable. Log in again.");

  const created = await createApiToken({
    userId: session.id,
    label: label || "OpenMontage",
    scopes: normalizeScopes(body.scopes),
    expiresAt,
    sealedWrappingKey: sealSecret(session.wrappingKey),
  });

  return { token: created.token, record: created.record, tokens: await listApiTokens(session.id) };
}

export async function revokeApiTokenAction(data: unknown): Promise<PublicApiToken[]> {
  const session = await requireActiveUser();
  const body = asObject(data);
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid token");
  await revokeApiToken(session.id, id);
  return listApiTokens(session.id);
}

export async function clearEncryptedPlatformKey(): Promise<AuthState> {
  const session = await requireActiveUser();
  await deleteApiKey(session.id);
  return {
    user: {
      id: session.id,
      username: session.username,
      role: session.role,
      status: session.status,
    },
    hasApiKey: false,
  };
}

function asObject(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid request");
  }
  return data as Record<string, unknown>;
}
