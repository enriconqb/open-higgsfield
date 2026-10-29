/**
 * Rebuilds the missing studio gallery rows for API jobs that were created before
 * the mirror existed.
 *
 *   pnpm exec tsx scripts/api-v1-backfill-gallery.ts [--user <id>] [--dry-run]
 *
 * A bearer-token generation never runs in a browser, so before the mirror was
 * added the finished asset only ever reached `usage_events` / `api_jobs` and was
 * invisible in the owner's own studio. This walks finished jobs and writes the
 * same gallery row the live mirror would have written, downloading the media so
 * the tiles survive the platform's signed URLs.
 *
 * Safe to run repeatedly: one row per (user, request id), refreshed in place.
 */
import "dotenv/config";

import type { RowDataPacket } from "mysql2/promise";

import { closePool, queryRows } from "@/db/client";
import { parseJobResult, type ApiJobRow } from "@/generation/api-jobs";
import { galleryHas, mirrorJobToGallery } from "@/generation/gallery";

const TERMINAL = new Set(["completed", "failed", "canceled", "cancelled"]);

function flag(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

type JobRow = ApiJobRow & RowDataPacket;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const onlyUser = flag("--user");

  const jobs = await queryRows<JobRow>(
    `SELECT request_id, user_id, token_id, model_id, prompt, settings, kind, status, cost_usd, error, result,
            idempotency_key, created_at, updated_at
     FROM api_jobs
     ${onlyUser ? "WHERE user_id = ?" : ""}
     ORDER BY created_at ASC`,
    onlyUser ? [Number(onlyUser)] : [],
  );

  console.log(`${jobs.length} api job(s) on record${onlyUser ? ` for user ${onlyUser}` : ""}`);

  let written = 0;
  let skipped = 0;

  for (const job of jobs) {
    const done = TERMINAL.has(job.status);
    if (!done) {
      skipped += 1;
      console.log(`  skip ${job.request_id} (${job.status}, not finished)`);
      continue;
    }
    const already = await galleryHas(job.user_id, job.request_id);
    if (dryRun) {
      const result = parseJobResult(job.result);
      const media = (result.images?.length ?? 0) + (result.video ? 1 : 0);
      console.log(
        `  would ${already ? "refresh" : "add"} ${job.request_id} for user ${job.user_id} (${media} media item(s))`,
      );
      continue;
    }
    await mirrorJobToGallery(job.user_id, job);
    written += 1;
    console.log(`  ${already ? "refreshed" : "added"} ${job.request_id} for user ${job.user_id}`);
  }

  console.log(dryRun ? "\nDry run: nothing written." : `\nDone. ${written} row(s) written, ${skipped} skipped.`);
  await closePool();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  await closePool().catch(() => undefined);
  process.exit(1);
});
