import { ApiError, requireApiContext } from "@/auth/api-auth";
import {
  createApiJob,
  findApiJobByIdempotency,
  storeJobImages,
  type ApiJobKind,
  type ApiJobResult,
  type ApiJobRow,
} from "@/generation/api-jobs";
import { getModel } from "@/generation/catalog";
import type { GenerationPlane, MediaItem, MediaRole, ModelEntry } from "@/generation/catalog/types";
import { submitPlane } from "@/generation/engine";

import { apiError, jsonOk, readJsonObject } from "../_lib/http";
import { jobResponse } from "../_lib/jobs";
import { enforceGenerationLimits } from "../_lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ROLES: readonly MediaRole[] = ["start", "end", "reference", "video", "audio"];
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{1,128}$/;
const DATA_URL = /^data:(?:image|video|audio)\/[a-z0-9.+-]+;base64,/i;
const MAX_SETTINGS = 40;

export async function POST(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request, "generate");
    enforceGenerationLimits(context.identity);

    const body = await readJsonObject(request);
    const idempotencyKey = idempotencyKeyOf(request, body);
    if (idempotencyKey) {
      const existing = await findApiJobByIdempotency(context.identity.userId, idempotencyKey);
      if (existing) return jsonOk({ ...jobResponse(request, existing), reused: true }, 200);
    }

    const plane = buildPlane(body);
    const kind = getModel(plane.model).surface;
    const queued = await submitPlane(context, plane);

    const immediate = queued.immediate;
    const result: ApiJobResult = {
      ...(immediate?.images?.length ? { images: await storeJobImages(immediate.images) } : {}),
      ...(immediate?.video?.url ? { video: { url: immediate.video.url } } : {}),
    };
    const status = immediate?.status ?? queued.status;
    const costUsd = immediate?.costUsd ?? null;

    const row: ApiJobRow = {
      request_id: queued.requestId,
      user_id: context.identity.userId,
      token_id: context.identity.tokenId,
      model_id: plane.model,
      kind,
      status,
      cost_usd: costUsd,
      error: null,
      result,
      idempotency_key: idempotencyKey,
      created_at: new Date(),
      updated_at: new Date(),
    };
    await recordJob(row, context.identity.userId, idempotencyKey, request);

    return jsonOk({ ...jobResponse(request, row), reused: false }, 202);
  } catch (caught) {
    return apiError(caught);
  }
}

/** The generation is already billed at this point, so a bookkeeping failure must
    not hide the request id from the caller. */
async function recordJob(
  row: ApiJobRow,
  userId: number,
  idempotencyKey: string | null,
  request: Request,
): Promise<void> {
  try {
    await createApiJob({
      requestId: row.request_id,
      userId,
      tokenId: row.token_id,
      modelId: row.model_id,
      kind: row.kind as ApiJobKind,
      status: row.status,
      idempotencyKey,
      costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      result: (row.result ?? null) as ApiJobResult | null,
    });
  } catch (caught) {
    const code = (caught as { code?: string }).code;
    if (idempotencyKey && code === "ER_DUP_ENTRY") {
      const existing = await findApiJobByIdempotency(userId, idempotencyKey);
      if (existing) {
        console.warn("[api] idempotency race", { requestId: existing.request_id, url: request.url });
        return;
      }
    }
    console.error("[api] job record failed", caught instanceof Error ? caught.message : caught);
  }
}

function idempotencyKeyOf(request: Request, body: Record<string, unknown>): string | null {
  const header = request.headers.get("idempotency-key")?.trim() ?? "";
  const raw = header || (typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "");
  if (!raw) return null;
  if (!IDEMPOTENCY.test(raw)) {
    throw new ApiError(400, "idempotencyKey may only use letters, digits, dot, dash, underscore, colon");
  }
  return raw;
}

function buildPlane(body: Record<string, unknown>): GenerationPlane {
  const modelId = requireText(body.model, "model", 128);
  const model = getModel(modelId);
  return {
    model: modelId,
    prompt: { text: requireText(body.prompt, "prompt", 8000) },
    media: buildMedia(body.media, model),
    settings: buildSettings(body.settings),
  };
}

function buildMedia(value: unknown, model: ModelEntry): GenerationPlane["media"] {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "media must be an object keyed by role");
  }
  const media: GenerationPlane["media"] = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const role = key.toLowerCase() as MediaRole;
    if (!ROLES.includes(role)) throw new ApiError(400, `Unknown media role: ${key}`);
    const max = model.roles[role];
    if (!max) throw new ApiError(400, `Model ${model.id} does not accept ${role} media`);
    if (!Array.isArray(raw)) throw new ApiError(400, `media.${role} must be an array`);
    if (raw.length > max) throw new ApiError(400, `media.${role} accepts at most ${max} item(s)`);
    media[role] = raw.map((item, index) => mediaItem(item, role, index));
  }
  return media;
}

function mediaItem(value: unknown, role: MediaRole, index: number): MediaItem {
  const label = `media.${role}[${index}]`;
  if (typeof value === "string") {
    return { id: `${role}-${index}`, url: requireUrl(value, label), role };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, `${label} must be a URL string or an object with a url`);
  }
  const record = value as { url?: unknown; id?: unknown };
  const id =
    typeof record.id === "string" && record.id.trim() ? record.id.trim().slice(0, 64) : `${role}-${index}`;
  return { id, url: requireUrl(record.url, label), role };
}

/** OpenRouter fetches these itself, so only https and inline data URLs work. */
function requireUrl(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, `${label} needs a url`);
  const url = value.trim();
  if (/^https:\/\//i.test(url) || DATA_URL.test(url)) return url;
  throw new ApiError(400, `${label} must be an https:// or data: URL`);
}

function buildSettings(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "settings must be an object");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_SETTINGS) throw new ApiError(400, "Too many settings");
  const settings: Record<string, unknown> = {};
  for (const [key, raw] of entries) {
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      settings[key] = raw;
      continue;
    }
    throw new ApiError(400, `settings.${key} must be a string, number, or boolean`);
  }
  return settings;
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, `${field} is required`);
  return value.trim().slice(0, max);
}
