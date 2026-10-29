import { withBasePath } from "@/base-path";
import { ApiError } from "@/auth/api-auth";
import { findApiJob, parseJobResult, updateApiJob, type ApiJobResult, type ApiJobRow } from "@/generation/api-jobs";
import { statusesFor, type GenerationContext } from "@/generation/engine";

import { originOf } from "./http";

const TERMINAL = new Set(["completed", "failed", "canceled", "cancelled"]);

/** Absolute URL a token client can fetch, including any mount prefix. */
export function jobBaseUrl(request: Request, requestId: string): string {
  return `${originOf(request)}${withBasePath(`/api/v1/jobs/${encodeURIComponent(requestId)}`)}`;
}

export function jobResponse(request: Request, job: ApiJobRow) {
  const base = jobBaseUrl(request, job.request_id);
  const result = parseJobResult(job.result);
  const images = (result.images ?? []).map((image) => ({
    index: image.index,
    mimeType: image.mime || null,
    bytes: image.bytes || null,
    url: image.id ? `${base}/files/${image.index}` : (image.url ?? null),
  }));
  const video = videoUrl(base, result.video?.url);
  return {
    requestId: job.request_id,
    model: job.model_id,
    kind: job.kind,
    status: job.status,
    costUsd: job.cost_usd === null ? null : Number(job.cost_usd),
    error: job.error,
    createdAt: iso(job.created_at),
    updatedAt: iso(job.updated_at),
    images,
    video: video ? { url: video } : null,
  };
}

/** A URL the platform handed out is usable as-is; our own proxy path is rewritten
    to the token-authenticated one, because a cookie route would 401 the client. */
function videoUrl(base: string, url: string | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.includes("/api/media")) return `${base}/content`;
  return url.startsWith("/") ? url : null;
}

/** 404 for a job that does not exist *and* for one owned by somebody else, so a
    token cannot probe which request ids are real. */
export async function requireJob(userId: number, requestId: string): Promise<ApiJobRow> {
  const job = await findApiJob(safeDecode(requestId));
  if (!job || job.user_id !== userId) throw new ApiError(404, "Job not found");
  return job;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Only a video still in flight is worth a round trip — and only that call needs
    the platform key, so a broken key still lets a client read finished jobs. */
export function jobNeedsPoll(job: ApiJobRow): boolean {
  return job.kind === "video" && !TERMINAL.has(job.status);
}

/** Video jobs only finish on the platform side, so ask it before answering. */
export async function refreshJob(context: GenerationContext, job: ApiJobRow): Promise<ApiJobRow> {
  if (!jobNeedsPoll(job)) return job;
  const [result] = await statusesFor(context, [job.request_id]);
  if (!result) return job;
  if ("error" in result) {
    const error = clip(result.error);
    await updateApiJob(job.request_id, { error });
    return { ...job, error };
  }
  const status = result.status;
  const existing = parseJobResult(job.result);
  const next: ApiJobResult = {
    ...existing,
    ...(status.video?.url ? { video: { url: status.video.url } } : {}),
  };
  const error = status.error === undefined || status.error === null ? null : describeError(status.error);
  const costUsd =
    status.costUsd != null && status.costUsd > 0
      ? status.costUsd
      : job.cost_usd === null
        ? null
        : Number(job.cost_usd);
  await updateApiJob(job.request_id, { status: status.status, costUsd, error, result: next });
  return { ...job, status: status.status, cost_usd: costUsd, error, result: next };
}

function describeError(value: unknown): string {
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

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
