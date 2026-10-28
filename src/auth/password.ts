import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

const AUTH_KEY_LEN = 64;
const WRAP_KEY_LEN = 32;
const SALT_LEN = 32;

export function createPasswordSalt(): Buffer {
  return randomBytes(SALT_LEN);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, AUTH_KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Derives the per-user AES wrapping key from the login password + stored salt. */
export async function deriveWrappingKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password, salt, WRAP_KEY_LEN)) as Buffer;
}

export function requirePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (password.length > 200) throw new Error("Password is too long");
  return password;
}

export function requireUsername(username: unknown): string {
  if (typeof username !== "string") throw new Error("Enter a username");
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(normalized)) {
    throw new Error("Username must be 3–32 characters: letters, numbers, underscore");
  }
  return normalized;
}
