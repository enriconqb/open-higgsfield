/**
 * Mint an API token for an existing account, headlessly.
 *
 * This is the same check the login form performs: the password derives the
 * wrapping key, and that key must unlock the platform key already stored for the
 * account. Only then is a token issued — a wrong password fails here instead of
 * producing a token that 409s later.
 *
 *   set VICEND_LOGIN_PASSWORD=...
 *   pnpm exec tsx scripts/api-v1-login-token.ts --user root
 *   pnpm exec tsx scripts/api-v1-login-token.ts --user root --label "openmontage" --out C:\path\to\env.txt
 *
 * The token is written to the output file (default %TEMP%\vicend-<user>-env.txt)
 * and never printed. Refuses a database that is not on this machine unless
 * --force is passed.
 */
import "dotenv/config";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createApiToken } from "@/auth/api-tokens";
import { decryptApiKey } from "@/auth/crypto-key";
import { deriveWrappingKey, verifyPassword } from "@/auth/password";
import { sealSecret } from "@/auth/sealed-key";
import { closePool } from "@/db/client";
import { findUserByUsername, getApiKeyRow } from "@/auth/users";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function flag(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host) && !process.argv.includes("--force")) {
    console.error(`Refusing to issue a token against ${host}. Pass --force when you mean it.`);
    process.exit(2);
  }

  const username = (flag("user") ?? "").trim().toLowerCase();
  if (!username) {
    console.error("Pass --user <username>");
    process.exit(2);
  }
  const password = process.env.VICEND_LOGIN_PASSWORD ?? "";
  if (!password) {
    console.error("Set VICEND_LOGIN_PASSWORD (the account password) for this run");
    process.exit(2);
  }

  const user = await findUserByUsername(username);
  if (!user) {
    console.error(`No such account: ${username}`);
    process.exit(2);
  }
  if (user.status !== "active") {
    console.error(`Account ${username} is ${user.status}; an API token would be refused anyway`);
    process.exit(2);
  }

  /** Exactly what the login form checks first. Failing here means the form would
      refuse the same password, so say so instead of blaming the token. */
  if (!(await verifyPassword(password, user.password_hash))) {
    console.error(
      `Password does not match account "${username}" in this database. The login form runs this ` +
        "same check, so it would refuse it too — check which Vicend instance you are signing in to.",
    );
    process.exit(2);
  }

  const wrappingKey = (await deriveWrappingKey(password, user.password_salt)).toString("base64");
  const keyRow = await getApiKeyRow(user.id);
  let keyState = "no platform key saved (generate will answer 409 until one is added)";
  if (keyRow) {
    try {
      const decrypted = decryptApiKey(keyRow, Buffer.from(wrappingKey, "base64"));
      keyState = `platform key unlocked (${decrypted.provider})`;
    } catch {
      console.error("Password is wrong, or the stored platform key was saved from another password.");
      process.exit(2);
    }
  }
  const created = await createApiToken({
    userId: user.id,
    label: flag("label", "local test") ?? "local test",
    scopes: ["read", "generate"],
    expiresAt: null,
    sealedWrappingKey: sealSecret(wrappingKey),
  });

  const base = (process.env.VICEND_DEV_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const outPath = path.resolve(
    flag("out") ?? path.join(process.env.TEMP ?? ".", `vicend-${username}-env.txt`),
  );
  await writeFile(outPath, `VICEND_BASE_URL=${base}\nVICEND_API_TOKEN=${created.token}\n`, "utf8");

  console.log(`Account : ${username} (id ${user.id}, ${user.role})`);
  console.log(`Database: ${new URL(raw).host}${new URL(raw).pathname}`);
  console.log(`Password: matches the stored hash (login form would accept it)`);
  console.log(`Key     : ${keyState}`);
  console.log(`Token   : ${created.record.hint} … written to ${outPath}`);
  console.log(`Revoke it later at ${base}/account (label: ${created.record.label}).`);
  await closePool();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
