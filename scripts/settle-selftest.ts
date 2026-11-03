/**
 * Offline self-test for the server-side settlement worker.
 *
 * A studio generation used to be finished by the tab that started it. This test
 * proves the server can finish one on its own: it creates throwaway jobs with
 * sealed credentials, feeds the settle pass a *fake* platform status (nothing
 * here touches the network or spends money), and checks what the database and
 * the uploads directory look like afterwards.
 *
 *   pnpm exec tsx scripts/settle-selftest.ts
 *
 * Refuses to run against a database that is not on this machine unless --force
 * is passed, and deletes every row and file it created when it finishes.
 */
import "dotenv/config";

import { randomBytes } from "node:crypto";
import { access, unlink } from "node:fs/promises";

import type { RowDataPacket } from "mysql2/promise";

import { sealSecret } from "@/auth/sealed-key";
import { createUser, deleteUser } from "@/auth/users";
import { createPasswordSalt, hashPassword } from "@/auth/password";
import { closePool, execute, queryOne } from "@/db/client";
import { createApiJob, findApiJob } from "@/generation/api-jobs";
import type { GenerationContext } from "@/generation/engine";
import { upsertGenerationResult } from "@/generation/gallery";
import { uploadFilePath } from "@/generation/local-upload";
import type { GenerationStatus, StatusResult } from "@/generation/platform";
import { listGenerationResultsFor, replaceGenerationResultsFor } from "@/generation/results";
import { settleOutstandingJobs } from "@/generation/settle";
import { recordUsage } from "@/usage/record";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAAABgADNjd8qAAAAABJRU5ErkJggg==";

let checks = 0;
let failures = 0;

function report(name: string, ok: boolean, note = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${note ? `  — ${note}` : ""}`);
}

/** The platform, stubbed: the same shape `statusesFor` answers with. */
function fakeStatus(status: GenerationStatus) {
  return async (_context: GenerationContext, requestIds: string[]): Promise<StatusResult[]> =>
    requestIds.map((requestId) => ({ requestId, status: { ...status, requestId } }));
}

function fakeUnreachable(message: string) {
  return async (_context: GenerationContext, requestIds: string[]): Promise<StatusResult[]> =>
    requestIds.map((requestId) => ({ requestId, error: message }));
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

  const suffix = randomBytes(4).toString("hex");
  const username = `settletest_${suffix}`;
  const passwordSalt = createPasswordSalt();
  const userId = await createUser({
    username,
    passwordHash: await hashPassword(`selftest-${suffix}`),
    passwordSalt,
    role: "user",
    status: "active",
  });
  const files: string[] = [];

  try {
    await runTests(userId, suffix, files);
  } finally {
    await execute(`DELETE FROM gallery_trash WHERE user_id = ?`, [userId]).catch(() => undefined);
    for (const file of files) {
      await unlink(file).catch(() => {});
      await unlink(`${file}.type`).catch(() => {});
    }
    await deleteUser(userId).catch(() => {});
    await closePool();
    console.log(`\n${checks - failures}/${checks} checks passed${failures ? `, ${failures} failed` : ""}`);
    process.exit(failures ? 1 : 0);
  }
}

async function runTests(userId: number, suffix: string, files: string[]): Promise<void> {
  const sealed = sealSecret(JSON.stringify({ provider: "openrouter", apiKey: "sk-or-v1-selftest-unused" }));

  // --- a job still running is left alone ----------------------------------
  const runningId = `settle-${suffix}-running`;
  await newJob(userId, runningId, "video", sealed);
  await recordUsage({
    userId,
    requestId: runningId,
    modelId: "seedance-2.5",
    kind: "video",
    spec: "480p · 4s",
    costUsd: 0.4,
    status: "pending",
  });

  const whileRunning = await settleOutstandingJobs({
    userId,
    statuses: fakeStatus({ status: "in_progress", requestId: runningId }),
  });
  const stillRunning = await findApiJob(runningId);
  report(
    "a running job stays pending and keeps its sealed key",
    whileRunning.pending === 1 && stillRunning?.status === "in_progress" && Boolean(stillRunning.sealed_credentials),
    `summary=${JSON.stringify(whileRunning)}`,
  );

  // --- one unreachable poll is not a failure ------------------------------
  const once = await settleOutstandingJobs({
    userId,
    statuses: fakeUnreachable("fetch failed (CERT_NOT_YET_VALID)"),
  });
  const afterOneMiss = await findApiJob(runningId);
  report(
    "an unreachable poll only counts an attempt",
    once.pending === 1 && afterOneMiss?.attempts === 1 && afterOneMiss.status === "in_progress",
    `attempts=${afterOneMiss?.attempts}`,
  );

  // --- repeated failure ends the job, not the charge ----------------------
  const second = await settleOutstandingJobs({
    userId,
    maxAttempts: 2,
    statuses: fakeUnreachable("fetch failed (CERT_NOT_YET_VALID)"),
  });
  const failed = await findApiJob(runningId);
  const failedUsage = await usageStatus(runningId, userId);
  const failedRows = (await listGenerationResultsFor(userId)).filter((row) => row.requestId === runningId);
  report(
    "giving up marks the job and the charge failed and clears the key",
    second.failed === 1 &&
      failed?.status === "failed" &&
      failed.sealed_credentials === null &&
      failedUsage === "failed",
    `summary=${JSON.stringify(second)} usage=${failedUsage}`,
  );
  report(
    "the failure reaches the gallery with a reason",
    failedRows.length === 1 && failedRows[0]?.status === "failed" && Boolean(failedRows[0]?.error),
    failedRows[0]?.error ?? "no row",
  );

  // --- a finished job is archived and mirrored without a browser -----------
  const doneId = `settle-${suffix}-done`;
  await newJob(userId, doneId, "image", sealed);
  await recordUsage({
    userId,
    requestId: doneId,
    modelId: "flux-2",
    kind: "image",
    spec: "1024",
    costUsd: 0.03,
    status: "pending",
  });

  const finished = await settleOutstandingJobs({
    userId,
    statuses: fakeStatus({
      status: "completed",
      requestId: doneId,
      images: [{ url: `data:image/png;base64,${TINY_PNG}` }],
      costUsd: 0.03,
    }),
  });
  const completed = await findApiJob(doneId);
  const completedUsage = await usageStatus(doneId, userId);
  const completedRows = (await listGenerationResultsFor(userId)).filter((row) => row.requestId === doneId);
  const row = completedRows[0];
  const archived = row?.urls[0] ?? "";
  const fileId = /\/api\/uploads\/([0-9a-f-]{36})/i.exec(archived)?.[1] ?? "";
  if (fileId) files.push(uploadFilePath(fileId));
  let fileOnDisk = false;
  if (fileId) {
    fileOnDisk = await access(uploadFilePath(fileId)).then(
      () => true,
      () => false,
    );
  }

  report(
    "a completed job is archived, mirrored and its charge settled",
    finished.settled === 1 &&
      completed?.status === "completed" &&
      completed.sealed_credentials === null &&
      completedUsage === "success",
    `summary=${JSON.stringify(finished)} usage=${completedUsage}`,
  );
  report(
    "the studio row keeps the request id the browser would use",
    completedRows.length === 1 && row?.id === doneId && fileOnDisk,
    `id=${row?.id ?? "none"} url=${archived}`,
  );

  const idle = await settleOutstandingJobs({ userId, statuses: fakeStatus({ status: "in_progress", requestId: doneId }) });
  report("nothing terminal is picked up again", idle.checked === 0, JSON.stringify(idle));

  // --- a stale browser snapshot cannot delete a moving row ----------------
  const movingId = `settle-${suffix}-moving`;
  await newJob(userId, movingId, "video", sealed);
  await upsertGenerationResult(userId, {
    id: movingId,
    requestId: movingId,
    surface: "video",
    modelId: "seedance-2.5",
    modelLabel: "Seedance 2.5",
    prompt: "selftest",
    ratio: "16 / 9",
    meta: "480p · 4s",
    kind: "video",
    urls: [],
    status: "running",
    art: "none",
    createdAt: Date.now(),
  });
  await upsertGenerationResult(userId, {
    id: `settle-${suffix}-plain`,
    surface: "video",
    modelId: "seedance-2.5",
    modelLabel: "Seedance 2.5",
    prompt: "selftest",
    ratio: "16 / 9",
    meta: "480p · 4s",
    kind: "video",
    urls: [],
    status: "completed",
    art: "none",
    createdAt: Date.now(),
  });
  await replaceGenerationResultsFor(userId, []);
  const survivors = await listGenerationResultsFor(userId);
  report(
    "an empty snapshot keeps the moving row and still deletes the rest",
    survivors.some((entry) => entry.id === movingId) &&
      !survivors.some((entry) => entry.id === `settle-${suffix}-plain`),
    survivors.map((entry) => entry.id).join(", ") || "none",
  );
}

async function newJob(userId: number, requestId: string, kind: "image" | "video", sealed: string): Promise<void> {
  await createApiJob({
    requestId,
    userId,
    tokenId: null,
    modelId: kind === "image" ? "flux-2" : "seedance-2.5",
    kind,
    status: "pending",
    idempotencyKey: null,
    prompt: "selftest",
    settings: { resolution: "480p", duration: 4 },
    sealedCredentials: sealed,
  });
}

async function usageStatus(requestId: string, userId: number): Promise<string | null> {
  const row = await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM usage_events WHERE request_id = ? AND user_id = ? LIMIT 1`,
    [requestId, userId],
  );
  return row?.status ?? null;
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await closePool().catch(() => undefined);
  process.exit(1);
});
