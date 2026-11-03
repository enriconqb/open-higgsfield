import { sealSecret, unsealSecret } from "@/auth/sealed-key";
import { SITE_URL } from "@/site";
import { settleUsage, usageStatusFromPlatform } from "@/usage/record";

import {
  bumpApiJobAttempts,
  listSettleableJobs,
  TERMINAL_JOB_STATUSES,
  updateApiJob,
  type ApiJobResult,
  type ApiJobRow,
} from "./api-jobs";
import type { GenerationCredentials } from "./engine";
import { statusesFor, type GenerationContext } from "./engine";
import { mirrorStudioJobToGallery } from "./gallery";
import type { GenerationStatus } from "./platform";
import { openRouterBaseUrl } from "./platform";

/* A studio run used to be followed by the tab that started it: every poll, the
   media archive and the gallery write happened because a browser asked. Closing
   the browser therefore stopped all three, and the platform's signed links
   expire within a day — a finished generation could be lost by walking away.
   
   The server now keeps the same watch itself. The platform key the submit
   already had in memory is sealed with SESSION_SECRET onto the job row (the
   envelope api_tokens already uses for `sealed_wrapping_key`); the worker
   unseals it for the lifetime of the run and the row drops it the moment the
   job reaches a terminal state. Nothing here is reachable from a browser: the
   sealed value is only ever read by this module. */

export const DEFAULT_SETTLE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_SETTLE_MAX_ATTEMPTS = 120;
export const DEFAULT_SETTLE_LIMIT = 10;

export type SettleSummary = {
  checked: number;
  settled: number;
  failed: number;
  pending: number;
};

type Ask = typeof statusesFor;

/** Sealed copy of the credentials a submitted job will need to be polled
    without the session that started it. */
export function sealJobCredentials(credentials: GenerationCredentials): string {
  return sealSecret(JSON.stringify({ provider: credentials.provider, apiKey: credentials.apiKey }));
}

/** Follow every studio job that a browser is no longer needed for. Cheap when
    there is nothing to do: one indexed select. */
export async function settleOutstandingJobs(
  opts: {
    userId?: number;
    limit?: number;
    maxAgeMs?: number;
    maxAttempts?: number;
    /** Injected by the self-test; the real one asks the platform. */
    statuses?: Ask;
  } = {},
): Promise<SettleSummary> {
  const maxAgeMs = opts.maxAgeMs ?? envNumber("STUDIO_SETTLE_MAX_AGE_MS", DEFAULT_SETTLE_MAX_AGE_MS);
  const maxAttempts = opts.maxAttempts ?? envNumber("STUDIO_SETTLE_MAX_ATTEMPTS", DEFAULT_SETTLE_MAX_ATTEMPTS);
  const jobs = await listSettleableJobs({
    userId: opts.userId,
    limit: opts.limit ?? DEFAULT_SETTLE_LIMIT,
    maxAgeMs,
  });
  const ask = opts.statuses ?? statusesFor;
  const summary: SettleSummary = { checked: jobs.length, settled: 0, failed: 0, pending: 0 };
  for (const job of jobs) {
    try {
      const outcome = await settleJob(job, ask, { maxAgeMs, maxAttempts });
      summary[outcome] += 1;
    } catch (caught) {
      /* One unreachable row must not stop the rest of the batch. */
      summary.pending += 1;
      console.error("[settle] job failed", {
        requestId: job.request_id,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }
  return summary;
}

/** Fire-and-forget sweep for one account, used when the studio is opened so a
    finished run appears at once instead of at the next tick. */
export function kickSettle(userId: number): void {
  void settleOutstandingJobs({ userId }).catch((caught) => {
    console.error("[settle] kick failed", caught instanceof Error ? caught.message : caught);
  });
}

async function settleJob(
  job: ApiJobRow,
  ask: Ask,
  opts: { maxAgeMs: number; maxAttempts: number },
): Promise<"settled" | "failed" | "pending"> {
  const credentials = credentialsFromSealed(job.sealed_credentials);
  if (!credentials) {
    await failJob(
      job,
      "This run's platform key could not be unlocked again (the server secret changed). Submit it again from the studio.",
    );
    return "failed";
  }

  const context: GenerationContext = { userId: job.user_id, credentials, origin: SITE_URL };
  const [result] = await ask(context, [job.request_id]);
  if (!result) return "pending";

  if ("error" in result) {
    const attempts = await bumpApiJobAttempts(job.request_id, clip(result.error));
    if (attempts >= opts.maxAttempts || ageMs(job) > opts.maxAgeMs) {
      await failJob(job, `The platform could not be reached for this run — ${clip(result.error)}`);
      return "failed";
    }
    return "pending";
  }

  const status = result.status;
  const terminal = TERMINAL_JOB_STATUSES.includes(status.status);
  const error = status.error === undefined || status.error === null ? null : describe(status.error);
  const costUsd =
    status.costUsd != null && status.costUsd > 0
      ? status.costUsd
      : job.cost_usd === null
        ? null
        : Number(job.cost_usd);
  const stored = jobResultFromStatus(status);

  await updateApiJob(job.request_id, {
    status: status.status,
    costUsd,
    error,
    result: stored,
    ...(terminal ? { sealedCredentials: null } : {}),
  });
  if (!terminal) return "pending";

  /* The row is finished: archive what the platform handed out, write it into
     the owner's gallery, and settle the charge that was recorded at submit. */
  const settledRow: ApiJobRow = { ...job, status: status.status, cost_usd: costUsd, error, result: stored };
  await mirrorStudioJobToGallery(job.user_id, settledRow);
  const usage = usageStatusFromPlatform(status.status);
  if (usage) {
    await settleUsage({
      requestId: job.request_id,
      status: usage,
      ...(status.costUsd != null && status.costUsd > 0 ? { costUsd: status.costUsd } : {}),
      userId: job.user_id,
    });
  }
  return status.status === "completed" ? "settled" : "failed";
}

/** The job is over without a usable result: say so in the gallery and release
    the charge, so nothing is left pending forever. */
async function failJob(job: ApiJobRow, message: string): Promise<void> {
  await updateApiJob(job.request_id, { status: "failed", error: message, sealedCredentials: null });
  const failed: ApiJobRow = { ...job, status: "failed", error: message };
  await mirrorStudioJobToGallery(job.user_id, failed);
  await settleUsage({ requestId: job.request_id, status: "failed", userId: job.user_id });
}

function credentialsFromSealed(sealed: string | null): GenerationCredentials | null {
  const raw = unsealSecret(sealed);
  if (!raw) return null;
  let parsed: { provider?: unknown; apiKey?: unknown };
  try {
    parsed = JSON.parse(raw) as { provider?: unknown; apiKey?: unknown };
  } catch {
    return null;
  }
  const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
  if (!apiKey) return null;
  const provider = parsed.provider === "higgsfield" ? "higgsfield" : "openrouter";
  const baseUrl =
    provider === "higgsfield" ? (process.env.HF_API_BASE_URL?.trim() ?? "") : openRouterBaseUrl();
  if (!baseUrl) return null;
  return { apiKey, baseUrl, provider };
}

/** The archived copy the status carried, in the shape `api_jobs.result` keeps.
    Shared with the studio submit, which stores an image job's answer at once. */
export function jobResultFromStatus(status: GenerationStatus): ApiJobResult {
  const images = status.images?.map((image, index) => ({
    index,
    mime: "",
    bytes: 0,
    url: image.url,
    ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
  }));
  return {
    ...(images?.length ? { images } : {}),
    ...(status.video
      ? {
          video: {
            url: status.video.url,
            ...(status.video.sourceUrl ? { sourceUrl: status.video.sourceUrl } : {}),
          },
        }
      : {}),
  };
}

function describe(value: unknown): string {
  if (typeof value === "string") return clip(value);
  try {
    return clip(JSON.stringify(value) ?? "Generation failed");
  } catch {
    return "Generation failed";
  }
}

function clip(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 500 ? `${clean.slice(0, 500)}…` : clean;
}

function ageMs(job: ApiJobRow): number {
  const created = job.created_at instanceof Date ? job.created_at.getTime() : Date.parse(String(job.created_at));
  return Number.isFinite(created) ? Date.now() - created : 0;
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
