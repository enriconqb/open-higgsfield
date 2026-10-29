import type { RowDataPacket } from "mysql2/promise";

import { execute, queryOne } from "@/db/client";
import { getModel } from "@/generation/catalog";
import type { Surface } from "@/generation/catalog";
import { isRunRecord, type RunRecord } from "@/openhiggsfield/history";
import { ensureArchivedUrl, isArchivedMediaUrl } from "./archive-media";
import { parseJobResult, type ApiJobResult, type ApiJobRow, type StoredImage } from "./api-jobs";
import { uploadIdFrom } from "./local-upload";

/** Rows produced outside a browser (a bearer token on /api/v1) never reach the
    studio's own save path, which mirrors client state. They are written straight
    into `generation_results` here instead, so a token generation shows up in the
    owner's gallery exactly like one made in the studio. */

const VIDEO_EXT = "mp4";

/** Deterministic gradient, so the same request always paints the same tile
    instead of flickering a new colour on every read. */
function tileArt(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  const hue = hash;
  const alt = (hue + 48) % 360;
  return [
    `radial-gradient(115% 88% at 24% 17%, oklch(0.76 0.16 ${hue} / 0.68), transparent 55%)`,
    `radial-gradient(88% 78% at 84% 85%, oklch(0.52 0.14 ${alt} / 0.62), transparent 60%)`,
    `linear-gradient(175deg, oklch(0.38 0.09 ${hue}), oklch(0.17 0.04 ${alt}))`,
  ].join(", ");
}

function ratioOf(settings: unknown): string {
  const raw = settings && typeof settings === "object" ? (settings as { aspectRatio?: unknown }).aspectRatio : null;
  if (typeof raw === "string" && /^\d+\s*:\s*\d+$/.test(raw)) return raw.replace(/\s*:\s*/, " / ");
  return "16 / 9";
}

function metaOf(row: ApiJobRow): string {
  const settings = row.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>) : {};
  const parts: string[] = [];
  if (typeof settings.resolution === "string" && settings.resolution) parts.push(settings.resolution);
  if (typeof settings.duration === "number" && settings.duration > 0) parts.push(`${settings.duration}s`);
  return parts.join(" · ") || (row.kind === "video" ? "video" : "image");
}

function badgeOf(row: ApiJobRow): string | undefined {
  const settings = row.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>) : {};
  const duration = typeof settings.duration === "number" ? settings.duration : null;
  if (duration && duration > 0) {
    const mins = Math.floor(duration / 60);
    const secs = Math.round(duration % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }
  return undefined;
}

function labelOf(modelId: string): string {
  try {
    const model = getModel(modelId) as { label?: string; name?: string };
    return model.label ?? model.name ?? modelId;
  } catch {
    return modelId;
  }
}

function promptOf(row: ApiJobRow): string {
  const prompt = row.prompt;
  if (typeof prompt === "string" && prompt.trim()) return prompt.trim().slice(0, 4000);
  return row.model_id;
}

/** `settings` and `prompt` are stored on the job row when it is created; rows
    made before migration 008 simply have none, which the record tolerates. */
function recordOf(row: ApiJobRow, urls: string[], surface: Surface, remoteUrls?: string[]): RunRecord {
  const status: RunRecord["status"] =
    row.status === "completed" ? "completed" : row.status === "failed" || row.status === "canceled" ? "failed" : "running";
  const createdAt = row.created_at instanceof Date ? row.created_at.getTime() : Date.parse(String(row.created_at));
  const record: RunRecord = {
    id: `${row.request_id}#api`,
    surface,
    modelId: row.model_id,
    modelLabel: labelOf(row.model_id),
    prompt: promptOf(row),
    ratio: ratioOf(row.settings),
    meta: metaOf(row),
    kind: row.kind,
    urls,
    ...(remoteUrls ? { remoteUrls } : {}),
    status,
    requestId: row.request_id,
    art: tileArt(row.request_id),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    via: "api",
    tokenId: row.token_id,
    ...(badgeOf(row) ? { badge: badgeOf(row) } : {}),
    ...(row.cost_usd === null ? {} : { costUsd: Number(row.cost_usd) }),
    ...(row.error ? { error: String(row.error).slice(0, 500) } : {}),
  };
  return record;
}

/**
 * Copies provider media into the uploads directory so a gallery tile keeps
 * working after the platform's signed URL expires (~24h). Returns the stored
 * image rows and a durable URL for the video, falling back to the original URL
 * when a download fails — a dead link later beats losing the record now.
 */
export async function archiveJobMedia(
  result: ApiJobResult,
  userId: number,
  requestId: string,
): Promise<{ images: StoredImage[]; videoUrl: string | null; videoSourceUrl?: string }> {
  const images: StoredImage[] = [];
  for (const image of result.images ?? []) {
    if (image.id) {
      images.push(image);
      continue;
    }
    if (!image.url) {
      images.push(image);
      continue;
    }
    images.push(await archiveRemote(image.url, image.mime || "image/png", image.index, userId, requestId));
  }

  const original = result.video?.url ?? null;
  if (!original) return { images, videoUrl: null };
  const stored = await archiveRemote(original, "video/mp4", images.length, userId, requestId, VIDEO_EXT);
  const videoUrl = stored.id ?? original;
  return { images, videoUrl, ...(stored.sourceUrl ? { videoSourceUrl: stored.sourceUrl } : {}) };
}

async function archiveRemote(
  url: string,
  mime: string,
  index: number,
  userId: number,
  requestId: string,
  ext?: string,
): Promise<StoredImage> {
  const local = await ensureArchivedUrl({ url, userId, requestId, index, mime });
  const id = isArchivedMediaUrl(local) ? uploadIdFrom(local) : null;
  /* The provider link outlives the copy it triggered: the gallery shows it
     while it answers, and a reference can still be sent from it. */
  const source = /^https:\/\//i.test(url) && url !== local ? { sourceUrl: url } : {};
  if (!id) return { index, mime, bytes: 0, url, ...source };
  return { index, mime, bytes: 0, id, ...(ext ? { ext } : {}), ...source };
}

/** Idempotent: one gallery row per (user, request id), refreshed in place. */
export async function upsertGenerationResult(userId: number, record: RunRecord): Promise<void> {
  if (!isRunRecord(record)) return;
  const stored = { ...record, id: record.id.slice(0, 191) };
  await execute(
    `INSERT INTO generation_results (user_id, client_id, payload)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
    [userId, stored.id, JSON.stringify(stored)],
  ).catch((caught) => {
    console.error("[gallery] upsert failed", caught instanceof Error ? caught.message : caught);
  });
}

/** Terminal jobs are mirrored into the owner's gallery; called after a poll or a
    submit has settled a job, so a token run shows up without any browser. */
export async function mirrorJobToGallery(userId: number, job: ApiJobRow): Promise<void> {
  try {
    const result = parseJobResult(job.result);
    const { images, videoUrl, videoSourceUrl } = await archiveJobMedia(result, userId, job.request_id);
    const surface: Surface = job.kind === "image" ? "image" : "video";

    const stored: ApiJobResult = {
      ...(images.length ? { images } : {}),
      ...(videoUrl
        ? { video: { url: videoUrl, ...(videoSourceUrl ? { sourceUrl: videoSourceUrl } : {}) } }
        : {}),
    };
    await execute(`UPDATE api_jobs SET result = ? WHERE request_id = ?`, [
      JSON.stringify(stored),
      job.request_id,
    ]).catch(() => undefined);

    const urls = buildUrls(job, images, videoUrl);
    /* One entry per url, aligned the way the studio reads it: the gallery takes
       the CDN link while it lasts and the archived copy once it stops. */
    const remoteUrls = urls.map((_url, index) =>
      surface === "image" ? (images[index]?.sourceUrl ?? "") : (videoSourceUrl ?? ""),
    );
    const record = recordOf(job, urls, surface, remoteUrls.some(Boolean) ? remoteUrls : undefined);
    await upsertGenerationResult(userId, record);
  } catch (caught) {
    console.error("[gallery] mirror failed", caught instanceof Error ? caught.message : caught);
  }
}

/** The URLs the studio renders. Archived bytes become `/api/uploads/<id>`, which
    the studio already knows how to play; a provider link stays as it is. */
function buildUrls(job: ApiJobRow, images: StoredImage[], videoUrl: string | null): string[] {
  if (job.kind === "image") {
    return images.map((image) => (image.id ? `/api/uploads/${image.id}` : (image.url ?? ""))).filter(Boolean);
  }
  if (!videoUrl) return [];
  if (/^https?:\/\//i.test(videoUrl)) return [videoUrl];
  return [videoUrl.startsWith("/") ? videoUrl : `/api/uploads/${videoUrl}`];
}

export async function galleryHas(userId: number, requestId: string): Promise<boolean> {
  const found = await queryOne<RowDataPacket>(
    `SELECT 1 AS ok FROM generation_results WHERE user_id = ? AND client_id = ? LIMIT 1`,
    [userId, `${requestId}#api`],
  );
  return Boolean(found);
}
