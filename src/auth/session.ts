import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { cookieSecure } from "./cookie-secure";
import type { SessionUser } from "./types";

export const SESSION_COOKIE = "ohf_session";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: cookieSecure(),
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 14,
};

function sessionSecret(): Buffer {
  const raw = process.env.SESSION_SECRET?.trim();
  if (!raw || raw.length < 16) {
    throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  }
  return createHash("sha256").update(raw).digest();
}

export function sealSession(user: SessionUser): string {
  const payload = Buffer.from(JSON.stringify(user), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionSecret(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function unsealSession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 1) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", sessionSecret(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as SessionUser;
    if (
      typeof parsed.id !== "number" ||
      typeof parsed.username !== "string" ||
      typeof parsed.wrappingKey !== "string" ||
      (parsed.role !== "superadmin" && parsed.role !== "user") ||
      parsed.status !== "active"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  return unsealSession(jar.get(SESSION_COOKIE)?.value);
}

export async function writeSession(user: SessionUser): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sealSession(user), SESSION_COOKIE_OPTIONS);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
}
