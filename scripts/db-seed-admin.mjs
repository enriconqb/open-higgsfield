import crypto from "node:crypto";
import { promisify } from "node:util";

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openPool } from "./_db.mjs";

const scrypt = promisify(crypto.scrypt);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${Buffer.from(derived).toString("base64")}`;
}

function requireUsername(raw) {
  const username = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    throw new Error(
      "SUPERADMIN_USERNAME must be 3–32 characters: letters, numbers, underscore",
    );
  }
  return username;
}

async function main() {
  const username = requireUsername(process.env.SUPERADMIN_USERNAME);
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!password) {
    throw new Error("Set SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD in .env before seeding.");
  }
  if (password.length < 8) {
    throw new Error("SUPERADMIN_PASSWORD must be at least 8 characters.");
  }

  const pool = await openPool();
  try {
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE role = 'superadmin' LIMIT 1",
    );
    if (existing.length > 0) {
      console.log("Superadmin already exists. Skipping seed.");
      return;
    }

    const [byUsername] = await pool.query("SELECT id FROM users WHERE username = ? LIMIT 1", [
      username,
    ]);
    if (byUsername.length > 0) {
      throw new Error(
        `Username ${username} is already registered. Use another SUPERADMIN_USERNAME.`,
      );
    }

    const passwordHash = await hashPassword(password);
    const passwordSalt = crypto.randomBytes(32);
    await pool.query(
      `INSERT INTO users (username, password_hash, password_salt, role, status)
       VALUES (?, ?, ?, 'superadmin', 'active')`,
      [username, passwordHash, passwordSalt],
    );
    console.log(`Superadmin created: ${username}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
