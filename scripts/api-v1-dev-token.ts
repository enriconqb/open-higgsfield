/**
 * Mint a local API token so the OpenMontage tools (or curl) can talk to a Vicend
 * running on this machine.
 *
 *   pnpm exec tsx scripts/api-v1-dev-token.ts
 *   pnpm exec tsx scripts/api-v1-dev-token.ts --out C:\path\to\vicend-dev-env.txt
 *
 * The token is never printed: it is written as VICEND_BASE_URL / VICEND_API_TOKEN
 * lines to the output file (default %TEMP%\vicend-dev-env.txt), which you can
 * either mark as read or paste into an app's .env.
 *
 * The account is "vicend_dev", kept across runs with its password rotated each
 * time. Set VICEND_DEV_PLATFORM_KEY to store a real OpenRouter key, which is what
 * makes a *real* local generation possible; without it the account gets a fake
 * key, so submits reach the provider and come back rejected — the honest way to
 * prove the wiring without paying for anything.
 */
import "dotenv/config";

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createApiToken } from "@/auth/api-tokens";
import { encryptApiKey } from "@/auth/crypto-key";
import { createPasswordSalt, deriveWrappingKey, hashPassword } from "@/auth/password";
import { sealSecret } from "@/auth/sealed-key";
import { closePool, execute } from "@/db/client";
import { createUser, deleteApiKey, findUserByUsername, upsertApiKey } from "@/auth/users";

const USERNAME = "vicend_dev";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host) && !process.argv.includes("--force")) {
    console.error(`Refusing to mint a dev token against ${host}. Pass --force when you mean it.`);
    process.exit(2);
  }

  const outIndex = process.argv.indexOf("--out");
  const outPath =
    outIndex !== -1 && process.argv[outIndex + 1]
      ? path.resolve(process.argv[outIndex + 1])
      : path.join(process.env.TEMP ?? ".", "vicend-dev-env.txt");

  const password = `dev-${randomBytes(12).toString("hex")}`;
  const passwordSalt = createPasswordSalt();
  const passwordHash = await hashPassword(password);
  const wrappingKey = (await deriveWrappingKey(password, passwordSalt)).toString("base64");

  const existing = await findUserByUsername(USERNAME);
  let userId: number;
  if (existing) {
    userId = existing.id;
    await execute(
      `UPDATE users SET password_hash = ?, password_salt = ?, role = 'user', status = 'active' WHERE id = ?`,
      [passwordHash, passwordSalt, userId],
    );
  } else {
    userId = await createUser({
      username: USERNAME,
      passwordHash,
      passwordSalt,
      role: "user",
      status: "active",
    });
  }

  const platformKey = process.env.VICEND_DEV_PLATFORM_KEY?.trim();
  const encrypted = encryptApiKey(
    platformKey || "sk-or-v1-dev-placeholder-key-that-is-never-valid",
    "openrouter",
    Buffer.from(wrappingKey, "base64"),
  );
  await upsertApiKey(userId, {
    provider: encrypted.provider,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  });
  if (existing && !platformKey) {
    // The rotated password cannot unlock the previous ciphertext; a stale row
    // would only fail later with a confusing 409.
    await deleteApiKey(userId).catch(() => {});
    await upsertApiKey(userId, {
      provider: encrypted.provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });
  }

  const created = await createApiToken({
    userId,
    label: "local dev",
    scopes: ["read", "generate"],
    expiresAt: null,
    sealedWrappingKey: sealSecret(wrappingKey),
  });

  const base = (process.env.VICEND_DEV_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  await writeFile(
    outPath,
    `VICEND_BASE_URL=${base}\nVICEND_API_TOKEN=${created.token}\n`,
    { encoding: "utf8" },
  );

  console.log(`Account : ${USERNAME} (id ${userId})`);
  console.log(`Token   : ${created.record.hint} … written to ${outPath}`);
  console.log(`Platform key: ${platformKey ? "real key from VICEND_DEV_PLATFORM_KEY" : "placeholder (submits will be rejected)"}`);
  console.log("Export those two lines before running any Vicend tool.");
  await closePool();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
