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
function recordOf(
  row: ApiJobRow,
  urls: string[],
  surface: Surface,
  opts: { remoteUrls?: string[]; id?: string; viaApi?: boolean } = {},
): RunRecord {
  const status: RunRecord["status"] =
    row.status === "completed" ? "completed" : row.status === "failed" || row.status === "canceled" ? "failed" : "running";
  const createdAt = row.created_at instanceof Date ? row.created_at.getTime() : Date.parse(String(row.created_at));
  const id = opts.id ?? `${row.request_id}#api`;
  const record: RunRecord = {
    id,
    surface,
    modelId: row.model_id,
    modelLabel: labelOf(row.model_id),
    prompt: promptOf(row),
    ratio: ratioOf(row.settings),
    meta: metaOf(row),
    kind: row.kind,
    urls,
    ...(opts.remoteUrls ? { remoteUrls: opts.remoteUrls } : {}),
    status,
    requestId: row.request_id,
    art: tileArt(id),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    ...(opts.viaApi ? { via: "api" as const, tokenId: row.token_id } : {}),
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
  const { readSession } = await import("@/auth/session");
  const session = await readSession();
  const inWorkspace = session?.id === userId;
  let teamId: number | null = null;
  if (inWorkspace && session) {
    const { workspaceFor } = await import("@/teams/access");
    teamId = (await workspaceFor(session)).teamId;
  }
  const owner = await queryOne<RowDataPacket & { username: string }>(
    `SELECT username FROM users WHERE id = ?`,
    [userId],
  );
  if (owner?.username && !stored.createdBy) stored.createdBy = owner.username;
  if (inWorkspace) {
    await execute(
      `INSERT INTO generation_results (user_id, team_id, created_by, client_id, payload)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), team_id = VALUES(team_id), created_by = COALESCE(generation_results.created_by, VALUES(created_by)), updated_at = CURRENT_TIMESTAMP`,
      [userId, teamId, userId, stored.id, JSON.stringify(stored)],
    ).catch((caught) => {
      console.error("[gallery] upsert failed", caught instanceof Error ? caught.message : caught);
    });
    const { notifyTeamGallery } = await import("./gallery-signal");
    notifyTeamGallery(teamId);
    return;
  }
  await execute(
    `INSERT INTO generation_results (user_id, created_by, client_id, payload)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), created_by = COALESCE(generation_results.created_by, VALUES(created_by)), updated_at = CURRENT_TIMESTAMP`,
    [userId, userId, stored.id, JSON.stringify(stored)],
  ).catch((caught) => {
    console.error("[gallery] upsert failed", caught instanceof Error ? caught.message : caught);
  });
  const storedTeam = await queryOne<RowDataPacket & { team_id: number | null }>(
    `SELECT team_id FROM generation_results WHERE user_id = ? AND client_id = ?`,
    [userId, stored.id],
  );
  const { notifyTeamGallery } = await import("./gallery-signal");
  notifyTeamGallery(storedTeam?.team_id == null ? null : Number(storedTeam.team_id));
}

/** Terminal jobs are mirrored into the owner's gallery; called after a poll or a
    submit has settled a job, so a token run shows up without any browser. */
export async function mirrorJobToGallery(userId: number, job: ApiJobRow): Promise<void> {
  await mirrorJob(userId, job, "api");
}

/** The same mirror for a job the *server* settled: a studio run whose browser
    closed (or was never reopened). The row keeps the studio's own id — one run,
    one tile — so an open studio saving the identical run upserts this row
    instead of adding a second one beside it. */
export async function mirrorStudioJobToGallery(userId: number, job: ApiJobRow): Promise<void> {
  await mirrorJob(userId, job, "studio");
}

async function mirrorJob(userId: number, job: ApiJobRow, mode: "api" | "studio"): Promise<void> {
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

    const records =
      mode === "api"
        ? [apiRecord(job, images, videoUrl, videoSourceUrl, surface)]
        : studioRecords(job, images, videoUrl, videoSourceUrl, surface);
    for (const record of records) await upsertGenerationResult(userId, record);
  } catch (caught) {
    console.error("[gallery] mirror failed", caught instanceof Error ? caught.message : caught);
  }
}

/** One row per request, the shape the token client reads: every url in `urls`
    and the provider links aligned beside them. */
function apiRecord(
  job: ApiJobRow,
  images: StoredImage[],
  videoUrl: string | null,
  videoSourceUrl: string | undefined,
  surface: Surface,
): RunRecord {
  const urls = buildUrls(job, images, videoUrl);
  /* One entry per url, aligned the way the studio reads it: the gallery takes
     the CDN link while it lasts and the archived copy once it stops. */
  const remoteUrls = urls.map((_url, index) =>
    surface === "image" ? (images[index]?.sourceUrl ?? "") : (videoSourceUrl ?? ""),
  );
  return recordOf(job, urls, surface, {
    viaApi: true,
    ...(remoteUrls.some(Boolean) ? { remoteUrls } : {}),
  });
}

/** The rows the studio itself would have written: a video is one row named by
    the request id, a batch of stills is one row per still with the same
    `<requestId>#<offset>` ids the composer builds. */
function studioRecords(
  job: ApiJobRow,
  images: StoredImage[],
  videoUrl: string | null,
  videoSourceUrl: string | undefined,
  surface: Surface,
): RunRecord[] {
  if (surface === "image" && images.length > 0) {
    const count = images.length;
    return images.map((image, index) => {
      const url = image.id ? `/api/uploads/${image.id}` : (image.url ?? "");
      const remote = image.sourceUrl && image.sourceUrl !== url ? [image.sourceUrl] : undefined;
      return recordOf(job, url ? [url] : [], surface, {
        id: rowIdOf(job.request_id, index, count),
        ...(remote ? { remoteUrls: remote } : {}),
      });
    });
  }
  const urls = buildUrls(job, images, videoUrl);
  const remoteUrls = urls.map(() => videoSourceUrl ?? "");
  return [
    recordOf(job, urls, surface, {
      id: job.request_id,
      ...(remoteUrls.some(Boolean) ? { remoteUrls } : {}),
    }),
  ];
}

/** Mirrors the composer's `rowId`: a lone result is named by the request. */
function rowIdOf(requestId: string, offset: number, count: number): string {
  return count > 1 ? `${requestId}#${offset}` : requestId;
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
