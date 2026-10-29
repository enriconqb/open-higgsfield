/**
 * End-to-end self-test for the Vicend /api/v1 surface.
 *
 * Creates throwaway accounts with their own password and a deliberately fake
 * platform key, mints real tokens through the same code the account page uses,
 * then drives the HTTP API with fetch. Nothing here spends money: the one call
 * that reaches OpenRouter is expected to come back rejected, which is exactly
 * what proves token -> stored key -> platform is wired end to end.
 *
 *   pnpm exec tsx scripts/api-v1-selftest.ts
 *
 * Refuses to run against a database that is not on this machine unless --force
 * is passed, and deletes every row and file it created when it finishes.
 */
import "dotenv/config";

import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";

import { createApiToken, revokeApiToken } from "@/auth/api-tokens";
import { encryptApiKey } from "@/auth/crypto-key";
import { createPasswordSalt, deriveWrappingKey, hashPassword } from "@/auth/password";
import { sealSecret } from "@/auth/sealed-key";
import { sealSession } from "@/auth/session";
import { createUser, deleteUser, upsertApiKey } from "@/auth/users";
import { createApiJob, findApiJob, storeJobImages } from "@/generation/api-jobs";
import { galleryHas, mirrorJobToGallery } from "@/generation/gallery";
import { uploadFilePath } from "@/generation/local-upload";
import { listGenerationResultsFor, replaceGenerationResultsFor } from "@/generation/results";

const BASE = (process.env.VICEND_SELFTEST_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAAABgADNjd8qAAAAABJRU5ErkJggg==";

type Reply = { status: number; body: unknown; headers: Headers };

let checks = 0;
let failures = 0;

function report(name: string, ok: boolean, note = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${note ? `  — ${note}` : ""}`);
}

function detailOf(body: unknown): string {
  if (body !== null && typeof body === "object" && "detail" in body) {
    return String((body as { detail: unknown }).detail);
  }
  return typeof body === "string" ? body.slice(0, 160) : "";
}

async function call(
  path: string,
  init: { method?: string; token?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    redirect: "manual",
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host) && !process.argv.includes("--force")) {
    console.error(`Refusing to run against ${host}. Pass --force when you mean it.`);
    process.exit(2);
  }

  console.log(`Vicend /api/v1 self-test against ${BASE} (database ${host})`);

  const suffix = randomBytes(4).toString("hex");
  const accounts: number[] = [];
  const files: string[] = [];

  try {
    const alice = await makeAccount(`omtest_a_${suffix}`, accounts);
    const bob = await makeAccount(`omtest_b_${suffix}`, accounts);

    await runTests(alice, bob, files);
  } finally {
    for (const id of accounts) await deleteUser(id).catch(() => {});
    for (const file of files) {
      await unlink(file).catch(() => {});
      await unlink(`${file}.type`).catch(() => {});
    }
    console.log(`\n${checks - failures}/${checks} checks passed${failures ? `, ${failures} failed` : ""}`);
    process.exit(failures ? 1 : 0);
  }
}

type Account = {
  userId: number;
  username: string;
  /** Base64 wrapping key, kept so the test can mint further tokens. */
  wrappingKey: string;
  token: string;
  readOnlyToken: string;
  readOnlyTokenId: number;
  expiredToken: string;
  sessionCookie: string;
};

async function makeAccount(username: string, accounts: number[]): Promise<Account> {
  const password = `selftest-${randomBytes(6).toString("hex")}`;
  const passwordSalt = createPasswordSalt();
  const userId = await createUser({
    username,
    passwordHash: await hashPassword(password),
    passwordSalt,
    role: "user",
    status: "active",
  });
  accounts.push(userId);

  const wrappingKey = (await deriveWrappingKey(password, passwordSalt)).toString("base64");
  const encrypted = encryptApiKey(
    "sk-or-v1-selftest-key-that-openrouter-will-reject",
    "openrouter",
    Buffer.from(wrappingKey, "base64"),
  );
  await upsertApiKey(userId, {
    provider: encrypted.provider,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  });

  const sealed = sealSecret(wrappingKey);
  const token = await mint(userId, "selftest-full", ["read", "generate"], null, sealed);
  const readOnly = await mint(userId, "selftest-read", ["read"], null, sealed);
  const expired = await mint(userId, "selftest-expired", ["read", "generate"], new Date(Date.now() - 60_000), sealed);

  return {
    userId,
    username,
    wrappingKey,
    token: token.token,
    readOnlyToken: readOnly.token,
    readOnlyTokenId: readOnly.id,
    expiredToken: expired.token,
    sessionCookie: `ohf_session=${sealSession({ id: userId, username, role: "user", status: "active", wrappingKey })}`,
  };
}

async function mint(
  userId: number,
  label: string,
  scopes: Array<"read" | "generate">,
  expiresAt: Date | null,
  sealedWrappingKey: string,
): Promise<{ token: string; id: number }> {
  const created = await createApiToken({ userId, label, scopes, expiresAt, sealedWrappingKey });
  return { token: created.token, id: created.record.id };
}

async function runTests(alice: Account, bob: Account, files: string[]): Promise<void> {
  // --- token gate ---------------------------------------------------------
  const anonymous = await call("/api/v1/me");
  report("no token -> 401", anonymous.status === 401, detailOf(anonymous.body));

  const garbage = await call("/api/v1/me", { token: `vic_${"x".repeat(43)}` });
  report("unknown token -> 401", garbage.status === 401, detailOf(garbage.body));

  const wrongShape = await call("/api/v1/me", { token: "not-a-token" });
  report("non-vic token -> 401", wrongShape.status === 401, detailOf(wrongShape.body));

  const expired = await call("/api/v1/me", { token: alice.expiredToken });
  report("expired token -> 401", expired.status === 401, detailOf(expired.body));

  // --- identity ----------------------------------------------------------
  const me = await call("/api/v1/me", { token: alice.token });
  const meBody = me.body as { username?: string; scopes?: string[]; keyKind?: string; hasPlatformKey?: boolean };
  report(
    "GET /me -> 200 with owner, scopes, key kind",
    me.status === 200 &&
      meBody.username === alice.username &&
      meBody.keyKind === "openrouter" &&
      meBody.hasPlatformKey === true &&
      (meBody.scopes ?? []).includes("generate"),
    `${me.status} ${JSON.stringify(meBody.scopes ?? null)}`,
  );

  const models = await call("/api/v1/models", { token: alice.token });
  const modelList = (models.body as { models?: Array<{ id?: string; surface?: string }> }).models ?? [];
  report(
    "GET /models -> 200 with the OpenRouter catalog",
    models.status === 200 &&
      modelList.length > 0 &&
      modelList.every((item) => typeof item.id === "string" && (item.surface === "image" || item.surface === "video")),
    `${modelList.length} models`,
  );

  const readOnlyMe = await call("/api/v1/me", { token: alice.readOnlyToken });
  report("read-only token can still read /me", readOnlyMe.status === 200, `${readOnlyMe.status}`);

  // --- the API tokens page renders its own module -------------------------
  const page = await call("/tokens", { cookie: alice.sessionCookie });
  report(
    "GET /tokens shows the API tokens module",
    page.status === 200 && typeof page.body === "string" && page.body.includes("API tokens"),
    `${page.status}`,
  );
  const accountPage = await call("/account", { cookie: alice.sessionCookie });
  report(
    "GET /account stays a password-only page",
    accountPage.status === 200 &&
      typeof accountPage.body === "string" &&
      accountPage.body.includes("Change password") &&
      !accountPage.body.includes("Create token"),
    `${accountPage.status}`,
  );

  // --- generate validation ------------------------------------------------
  const noScope = await call("/api/v1/generate", {
    method: "POST",
    token: alice.readOnlyToken,
    body: { model: "flux-2", prompt: "hi" },
  });
  report("generate with read-only token -> 403", noScope.status === 403, detailOf(noScope.body));

  const empty = await call("/api/v1/generate", { method: "POST", token: alice.token, body: {} });
  report("generate without model -> 400", empty.status === 400, detailOf(empty.body));

  const unknownModel = await call("/api/v1/generate", {
    method: "POST",
    token: alice.token,
    body: { model: "no-such-model", prompt: "hi" },
  });
  report(
    "generate with unknown model -> 400",
    unknownModel.status === 400 && detailOf(unknownModel.body).startsWith("Unknown model"),
    detailOf(unknownModel.body),
  );

  const noPrompt = await call("/api/v1/generate", {
    method: "POST",
    token: alice.token,
    body: { model: "flux-2" },
  });
  report("generate without prompt -> 400", noPrompt.status === 400, detailOf(noPrompt.body));

  const badRole = await call("/api/v1/generate", {
    method: "POST",
    token: alice.token,
    body: { model: "flux-2", prompt: "hi", media: { selfie: [] } },
  });
  report("generate with unknown media role -> 400", badRole.status === 400, detailOf(badRole.body));

  const httpMedia = await call("/api/v1/generate", {
    method: "POST",
    token: alice.token,
    body: { model: "kling-3-std", prompt: "hi", media: { start: [{ url: "http://example.com/a.png" }] } },
  });
  report("generate with http:// reference -> 400", httpMedia.status === 400, detailOf(httpMedia.body));

  const tooMany = await call("/api/v1/generate", {
    method: "POST",
    token: alice.token,
    body: {
      model: "kling-3-std",
      prompt: "hi",
      media: {
        start: [
          { url: "https://example.com/a.png" },
          { url: "https://example.com/b.png" },
          { url: "https://example.com/c.png" },
        ],
      },
    },
  });
  report("generate beyond a role's limit -> 400", tooMany.status === 400, detailOf(tooMany.body));

  const badKey = await call("/api/v1/generate", {
    method: "POST",
    token: alice.token,
    body: { model: "flux-2", prompt: "hi" },
    headers: { "Idempotency-Key": "bad key!!" },
  });
  report("malformed idempotency key -> 400", badKey.status === 400, detailOf(badKey.body));

  // --- the platform really is reached ------------------------------------
  const upstream = await call("/api/v1/generate", {
    method: "POST",
    token: alice.token,
    body: { model: "flux-2", prompt: "selftest, this must never bill" },
  });
  report(
    "generate with a rejected platform key -> 502 from upstream",
    upstream.status === 502,
    `${upstream.status} ${detailOf(upstream.body)}`,
  );

  const afterFailure = await call("/api/v1/me", { token: alice.token });
  const usage = (afterFailure.body as { usage?: { last30Days?: { generations?: number } } }).usage;
  report(
    "a failed submit records no usage",
    usage?.last30Days?.generations === 0,
    JSON.stringify(usage ?? null),
  );

  // --- jobs --------------------------------------------------------------
  const missing = await call("/api/v1/jobs/does-not-exist", { token: alice.token });
  report("unknown job -> 404", missing.status === 404, detailOf(missing.body));

  const sharedId = `selftest-job-${randomBytes(4).toString("hex")}`;
  await createApiJob({
    requestId: sharedId,
    userId: bob.userId,
    tokenId: null,
    modelId: "flux-2",
    kind: "image",
    status: "completed",
    idempotencyKey: null,
    result: null,
  });
  const foreign = await call(`/api/v1/jobs/${sharedId}`, { token: alice.token });
  const owner = await call(`/api/v1/jobs/${sharedId}`, { token: bob.token });
  report("another user's job -> 404", foreign.status === 404, detailOf(foreign.body));
  report("the owner reads the same job -> 200", owner.status === 200, `${owner.status}`);

  // --- stored image bytes ------------------------------------------------
  const imageJobId = `selftest-img-${randomBytes(4).toString("hex")}`;
  const stored = await storeJobImages([{ url: `data:image/png;base64,${TINY_PNG}` }]);
  for (const image of stored) if (image.id) files.push(uploadFilePath(image.id));
  await createApiJob({
    requestId: imageJobId,
    userId: alice.userId,
    tokenId: null,
    modelId: "flux-2",
    kind: "image",
    status: "completed",
    idempotencyKey: null,
    result: { images: stored },
  });
  const file = await call(`/api/v1/jobs/${imageJobId}/files/0`, { token: alice.token });
  const bytes = typeof file.body === "string" ? Buffer.from(file.body, "binary").byteLength : 0;
  report(
    "image bytes come back with the stored type",
    file.status === 200 && file.headers.get("content-type") === "image/png" && bytes > 0,
    `${file.status} ${file.headers.get("content-type")} ${bytes}B`,
  );
  const fileAnon = await call(`/api/v1/jobs/${imageJobId}/files/0`);
  report("image bytes need a token -> 401", fileAnon.status === 401, `${fileAnon.status}`);
  const noImage = await call(`/api/v1/jobs/${imageJobId}/files/7`, { token: alice.token });
  report("missing image index -> 404", noImage.status === 404, detailOf(noImage.body));

  const jobJson = await call(`/api/v1/jobs/${imageJobId}`, { token: alice.token });
  const jobBody = jobJson.body as { images?: Array<{ url?: string }>; video?: unknown };
  report(
    "job json points at the token-authenticated file url",
    jobJson.status === 200 && (jobBody.images?.[0]?.url ?? "").endsWith(`/api/v1/jobs/${imageJobId}/files/0`),
    String(jobBody.images?.[0]?.url ?? ""),
  );

  // --- gallery mirroring -------------------------------------------------
  // A token generation has no browser to save it, so the job must appear in the
  // owner's own studio gallery by itself.
  const aliceJob = (await findApiJob(imageJobId))!;
  await mirrorJobToGallery(alice.userId, aliceJob);
  report("mirroring a finished job writes a gallery row", await galleryHas(alice.userId, imageJobId));
  await mirrorJobToGallery(alice.userId, aliceJob);
  const mineRows = await listGenerationResultsFor(alice.userId);
  const mirroredRows = mineRows.filter((row) => row.requestId === imageJobId);
  const mirroredRow = mirroredRows[0];
  report("mirroring twice still leaves exactly one row", mirroredRows.length === 1, `${mirroredRows.length} rows`);
  report(
    "the mirrored row is a valid studio record",
    Boolean(mirroredRow) && mirroredRow?.via === "api" && mirroredRow?.urls.length === 1,
    JSON.stringify(mirroredRow ?? null).slice(0, 160),
  );
  const foreignRows = await listGenerationResultsFor(bob.userId);
  report(
    "a mirrored row belongs only to its owner",
    !foreignRows.some((row) => row.requestId === imageJobId),
    `${foreignRows.length} rows for bob`,
  );

  // The studio saves by replacing the browser-owned rows; it must not sweep away
  // the token-made ones it has never seen.
  await replaceGenerationResultsFor(alice.userId, []);
  report(
    "a studio save does not delete token-made rows",
    await galleryHas(alice.userId, imageJobId),
    "after replace with an empty browser list",
  );

  // --- video redirect ----------------------------------------------------
  const videoJobId = `selftest-vid-${randomBytes(4).toString("hex")}`;
  await createApiJob({
    requestId: videoJobId,
    userId: alice.userId,
    tokenId: null,
    modelId: "kling-3-std",
    kind: "video",
    status: "completed",
    idempotencyKey: null,
    result: { video: { url: "https://example.com/selftest.mp4" } },
  });
  const content = await call(`/api/v1/jobs/${videoJobId}/content`, { token: alice.token });
  report(
    "finished video content redirects to the public url",
    content.status === 302 && content.headers.get("location") === "https://example.com/selftest.mp4",
    `${content.status} ${content.headers.get("location") ?? ""}`,
  );

  // --- revocation --------------------------------------------------------
  await revokeApiToken(alice.userId, alice.readOnlyTokenId);
  const revoked = await call("/api/v1/me", { token: alice.readOnlyToken });
  report("revoked token -> 401", revoked.status === 401, detailOf(revoked.body));

  // --- rate limit --------------------------------------------------------
  const burst = await mint(alice.userId, "selftest-burst", ["read", "generate"], null, sealSecret(alice.wrappingKey));
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const reply = await call("/api/v1/generate", {
      method: "POST",
      token: burst.token,
      body: { model: "no-such-model", prompt: "hi" },
    });
    statuses.push(reply.status);
  }
  report(
    "burst of generate calls hits the rate limit",
    statuses.includes(429) && statuses.includes(400),
    statuses.join(","),
  );

  const afterBurst = await call("/api/v1/me", { token: burst.token });
  report("the burst token still reads after the limit cools", afterBurst.status === 200, `${afterBurst.status}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
