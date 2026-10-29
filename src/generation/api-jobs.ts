import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "fs/promises";

import type { RowDataPacket } from "mysql2/promise";

import { execute, queryOne } from "@/db/client";

import { uploadFilePath, uploadRoot, uploadTypePath } from "./local-upload";

export type ApiJobKind = "image" | "video";

/** `id` means the bytes live in the uploads directory and are streamed back by
    /api/v1/jobs/<id>/files/<index>; `url` is used when the provider already
    handed out a fetchable https link. */
export type StoredImage = {
  index: number;
  mime: string;
  bytes: number;
  id?: string;
  url?: string;
  /** File extension hint for archived video bytes. */
  ext?: string;
};

export type ApiJobResult = {
  images?: StoredImage[];
  video?: { url: string };
};

export type ApiJobRow = {
  request_id: string;
  user_id: number;
  token_id: number | null;
  model_id: string;
  prompt: string | null;
  settings: unknown;
  kind: ApiJobKind;
  status: string;
  cost_usd: string | number | null;
  error: string | null;
  result: unknown;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
};

type JobPacket = ApiJobRow & RowDataPacket;

const SELECT_COLUMNS = `request_id, user_id, token_id, model_id, prompt, settings, kind, status, cost_usd, error,
   result, idempotency_key, created_at, updated_at`;

export async function createApiJob(input: {
  requestId: string;
  userId: number;
  tokenId: number | null;
  modelId: string;
  kind: ApiJobKind;
  status: string;
  idempotencyKey: string | null;
  costUsd?: number | null;
  result?: ApiJobResult | null;
  prompt?: string | null;
  settings?: Record<string, unknown> | null;
}): Promise<void> {
  await execute(
    `INSERT INTO api_jobs
       (request_id, user_id, token_id, model_id, prompt, settings, kind, status, cost_usd, result, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.requestId.slice(0, 128),
      input.userId,
      input.tokenId,
      input.modelId.slice(0, 128),
      input.prompt ? input.prompt.slice(0, 8000) : null,
      input.settings ? JSON.stringify(input.settings) : null,
      input.kind,
      input.status.slice(0, 32),
      input.costUsd ?? null,
      input.result ? JSON.stringify(input.result) : null,
      input.idempotencyKey ? input.idempotencyKey.slice(0, 128) : null,
    ],
  );
}

export async function findApiJob(requestId: string): Promise<ApiJobRow | null> {
  const row = await queryOne<JobPacket>(`SELECT ${SELECT_COLUMNS} FROM api_jobs WHERE request_id = ? LIMIT 1`, [
    requestId,
  ]);
  return row ? { ...row, settings: parseSettingsColumn(row.settings) } : null;
}

/** MySQL hands JSON back as a string through some drivers and as an object
    through others; callers should only ever see the object form. */
function parseSettingsColumn(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export async function findApiJobByIdempotency(
  userId: number,
  idempotencyKey: string,
): Promise<ApiJobRow | null> {
  return queryOne<JobPacket>(
    `SELECT ${SELECT_COLUMNS} FROM api_jobs WHERE user_id = ? AND idempotency_key = ? LIMIT 1`,
    [userId, idempotencyKey],
  );
}

export async function updateApiJob(
  requestId: string,
  patch: { status?: string; costUsd?: number | null; error?: string | null; result?: ApiJobResult | null },
): Promise<void> {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status.slice(0, 32));
  }
  if (patch.costUsd !== undefined) {
    sets.push("cost_usd = ?");
    params.push(patch.costUsd);
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    params.push(patch.error);
  }
  if (patch.result !== undefined) {
    sets.push("result = ?");
    params.push(patch.result ? JSON.stringify(patch.result) : null);
  }
  if (!sets.length) return;
  params.push(requestId);
  await execute(`UPDATE api_jobs SET ${sets.join(", ")} WHERE request_id = ?`, params);
}

export function parseJobResult(value: unknown): ApiJobResult {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return parseJobResult(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as { images?: unknown; video?: unknown };
  const images = Array.isArray(record.images)
    ? record.images.flatMap((item): StoredImage[] => {
        if (item === null || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.index !== "number") return [];
        return [
          {
            index: row.index,
            mime: typeof row.mime === "string" ? row.mime : "",
            bytes: typeof row.bytes === "number" ? row.bytes : 0,
            ...(typeof row.id === "string" ? { id: row.id } : {}),
            ...(typeof row.url === "string" ? { url: row.url } : {}),
          },
        ];
      })
    : undefined;
  const videoUrl =
    record.video !== null && typeof record.video === "object"
      ? (record.video as { url?: unknown }).url
      : undefined;
  return {
    ...(images?.length ? { images } : {}),
    ...(typeof videoUrl === "string" ? { video: { url: videoUrl } } : {}),
  };
}

/** OpenRouter returns image bytes inline as data URLs. They are far too large
    for a JSON reply, so they go to the uploads directory and the job keeps the
    file id. A provider that returns plain https links is stored as-is. */
export async function storeJobImages(images: Array<{ url: string }>): Promise<StoredImage[]> {
  const stored: StoredImage[] = [];
  for (const [index, image] of images.entries()) {
    stored.push(await storeJobImage(index, image.url));
  }
  return stored;
}

async function storeJobImage(index: number, url: string): Promise<StoredImage> {
  const data = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (!data) {
    return { index, mime: "", bytes: 0, url };
  }
  const mime = data[1] || "application/octet-stream";
  const payload = data[3] ?? "";
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, data[2] ? "base64" : "utf8");
  } catch {
    return { index, mime, bytes: 0, url };
  }
  const id = randomUUID();
  try {
    await mkdir(uploadRoot(), { recursive: true });
    await writeFile(uploadFilePath(id), bytes);
    await writeFile(uploadTypePath(id), mime);
    return { index, mime, bytes: bytes.byteLength, id };
  } catch (caught) {
    console.error("[api] image store failed", caught instanceof Error ? caught.message : caught);
    return { index, mime, bytes: bytes.byteLength, url };
  }
}
