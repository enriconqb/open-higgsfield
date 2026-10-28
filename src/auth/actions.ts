"use server";

import { encryptApiKey } from "./crypto-key";
import { requireActiveUser, requireSuperadmin } from "./guard";
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
  createUser,
  deleteApiKey,
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
