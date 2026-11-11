import { browserLegacy, defaultKv, type Kv, type LegacyStore } from "./idb";
import type { Surface } from "@/generation/catalog";

export type RunStatus = "running" | "completed" | "failed";

export interface RunRecord {
  id: string;
  surface: Surface;
  modelId: string;
  modelLabel: string;
  prompt: string;
  /** CSS aspect-ratio value, e.g. "16 / 9" */
  ratio: string;
  meta: string;
  badge?: string;
  kind: "image" | "video";
  urls: string[];
  /** Provider https URLs kept beside the local archive, one entry per url: the
      gallery shows them while they still answer and the disk copy after, and a
      video reference can be sent from one while this site is served over plain
      HTTP. Empty string marks a row that has no provider link. */
  remoteUrls?: string[];
  status: RunStatus;
  /** Platform request this row is waiting on. Set while status is running so a
      refresh can resume the poll; completed rows keep it for the same id. */
  requestId?: string;
  error?: string;
  /** Layered-gradient fallback used while media loads or when a run failed. */
  art: string;
  createdAt: number;
  /** Kept deliberately: shows in the Favorites scope and outlives the cap. */
  favorite?: boolean;
  /** Team favorites are per member. Personal workspaces keep using `favorite`. */
  favoriteUserIds?: number[];
  /** Hidden from the gallery and the attachment shelves. The files stay on disk. */
  archived?: boolean;
  /** Resolved catalog settings this run was submitted with, so reuse can
      restore the dials and not just the words. Absent on pre-existing records. */
  settings?: Record<string, unknown>;
  /** USD charged or estimated for this result. Absent on older records. */
  costUsd?: number;
  /** Present only on rows produced through /api/v1 with a bearer token, so the
      studio can label them apart from browser runs. */
  via?: "api";
  /** Username of the account that saved the run, shown on shared team assets. */
  createdBy?: string;
  /** Which API token produced the row, when one did. */
  tokenId?: number | null;
}

export const HISTORY_KEY = "history.v1";
export const LEGACY_HISTORY_KEY = "openhiggsfield.history.v1";
const MAX_RECORDS = 60;

export function historyKeyFor(userId: number, teamId?: number | null): string {
  return teamId ? `${HISTORY_KEY}.${userId}.team.${teamId}` : `${HISTORY_KEY}.${userId}`;
}

export function tombstoneKeyFor(userId: number, teamId?: number | null): string {
  return teamId ? `gallery.tombstone.v1.${userId}.team.${teamId}` : `gallery.tombstone.v1.${userId}`;
}

export async function loadTombstones(userId: number, kv: Kv = defaultKv(), teamId?: number | null): Promise<string[]> {
  try {
    const stored = await kv.get<unknown>(tombstoneKeyFor(userId, teamId));
    if (!Array.isArray(stored)) return [];
    return stored.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export async function saveTombstones(
  userId: number,
  ids: Iterable<string>,
  kv: Kv = defaultKv(),
  teamId?: number | null,
): Promise<void> {
  try {
    await kv.set(tombstoneKeyFor(userId, teamId), [...ids]);
  } catch {
    /* private mode or a denied store */
  }
}

export async function loadHistory(
  kv: Kv = defaultKv(),
  legacy: LegacyStore | undefined = browserLegacy(),
  key: string = HISTORY_KEY,
): Promise<RunRecord[]> {
  const stored = await readIdb(kv, key);
  const fromLegacy = key === HISTORY_KEY ? readLegacy(legacy) : [];
  if (stored.length === 0) return fromLegacy;
  if (fromLegacy.length === 0) return stored;
  return mergeHistory(stored, fromLegacy);
}

export async function saveHistory(
  records: RunRecord[],
  kv: Kv = defaultKv(),
  legacy: LegacyStore | undefined = browserLegacy(),
  key: string = HISTORY_KEY,
): Promise<void> {
  const next = orderHistory(records.filter(isRunRecord));
  try {
    await kv.set(key, next);
  } catch {
    /* private mode or a denied store */
  }
  if (key !== HISTORY_KEY) return;
  try {
    legacy?.setItem(LEGACY_HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* quota or a denied store */
  }
}

/** Session rows win on id collision so a generate that landed before IDB
    finished reading is not wiped by the delayed load. */
export function mergeHistory(stored: RunRecord[], live: RunRecord[]): RunRecord[] {
  const byId = new Map<string, RunRecord>();
  for (const row of [...stored, ...live]) {
    const prev = byId.get(row.id);
    if (!prev || newerRecord(row, prev)) byId.set(row.id, row);
  }
  return orderHistory([...byId.values()]);
}

async function readIdb(kv: Kv, key: string): Promise<RunRecord[]> {
  try {
    const stored = await kv.get<unknown>(key);
    if (!Array.isArray(stored)) return [];
    return orderHistory(stored.filter(isRunRecord));
  } catch {
    return [];
  }
}

function readLegacy(legacy: LegacyStore | undefined): RunRecord[] {
  if (!legacy) return [];
  try {
    const raw = legacy.getItem(LEGACY_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return orderHistory(parsed.filter(isRunRecord));
  } catch {
    return [];
  }
}

function orderHistory(records: RunRecord[]): RunRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export type GalleryCursor = { createdAt: number; id: string };

export const GALLERY_PAGE_SIZE = 24;

/** Newest first. The cursor is the last row already shown, so the next page starts after it. */
export function pageRuns(
  records: RunRecord[],
  cursor: GalleryCursor | null,
  limit = GALLERY_PAGE_SIZE,
): { records: RunRecord[]; nextCursor: GalleryCursor | null } {
  const sorted = orderHistory(records);
  let start = 0;
  if (cursor) {
    const index = sorted.findIndex(
      (record) =>
        record.createdAt < cursor.createdAt ||
        (record.createdAt === cursor.createdAt && record.id < cursor.id),
    );
    start = index < 0 ? sorted.length : index;
  }
  const slice = sorted.slice(start, start + limit);
  const last = slice[slice.length - 1];
  const more = start + slice.length < sorted.length;
  return { records: slice, nextCursor: more && last ? { createdAt: last.createdAt, id: last.id } : null };
}

/* Kept for a caller that still wants a window. The gallery no longer uses it:
   a row past the window was being treated as a deletion. */
export function capHistory(records: RunRecord[], max = MAX_RECORDS): RunRecord[] {
  if (records.length <= max) return records;
  let kept = 0;
  return records.filter(
    (record) => record.favorite === true || record.status === "running" || kept++ < max,
  );
}

export function requestIdOf(record: RunRecord): string {
  return record.requestId ?? record.id.split("#")[0]!;
}

/** Swap every row of a request for its terminal records, or no-op if the
    visitor already deleted the in-flight tiles. */
export function replaceRequest(
  records: RunRecord[],
  requestId: string,
  next: RunRecord[],
): RunRecord[] {
  if (!records.some((record) => record.status === "running" && requestIdOf(record) === requestId)) {
    return records;
  }
  return orderHistory([...next, ...records.filter((record) => requestIdOf(record) !== requestId)]);
}

function hasLocalMedia(record: RunRecord): boolean {
  return record.urls.some((url) => /\/(?:api\/)?uploads\/[0-9a-f-]{36}/i.test(url));
}

function newerRecord(row: RunRecord, prev: RunRecord): boolean {
  const rowDone = row.status !== "running";
  const prevDone = prev.status !== "running";
  if (rowDone !== prevDone) return rowDone;
  const rowLocal = hasLocalMedia(row);
  const prevLocal = hasLocalMedia(prev);
  if (rowLocal !== prevLocal) return rowLocal;
  return row.createdAt >= prev.createdAt;
}

export function isRunRecord(value: unknown): value is RunRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<RunRecord>;
  return (
    typeof record.id === "string" &&
    (record.surface === "image" || record.surface === "video") &&
    typeof record.prompt === "string" &&
    typeof record.ratio === "string" &&
    Array.isArray(record.urls) &&
    (record.remoteUrls === undefined ||
      (Array.isArray(record.remoteUrls) && record.remoteUrls.every((url) => typeof url === "string"))) &&
    (record.status === "completed" ||
      record.status === "failed" ||
      (record.status === "running" && typeof record.requestId === "string")) &&
    typeof record.createdAt === "number" &&
    (record.requestId === undefined || typeof record.requestId === "string") &&
    (record.favorite === undefined || typeof record.favorite === "boolean") &&
    (record.favoriteUserIds === undefined ||
      (Array.isArray(record.favoriteUserIds) && record.favoriteUserIds.every((id) => typeof id === "number"))) &&
    (record.archived === undefined || typeof record.archived === "boolean") &&
    (record.settings === undefined ||
      (typeof record.settings === "object" && record.settings !== null)) &&
    (record.costUsd === undefined || typeof record.costUsd === "number") &&
    (record.via === undefined || record.via === "api") &&
    (record.tokenId === undefined || record.tokenId === null || typeof record.tokenId === "number")
  );
}

export function keptBy(record: RunRecord, userId: number | null, team: boolean): boolean {
  if (!team) return record.favorite === true;
  return userId != null && (record.favoriteUserIds?.includes(userId) ?? false);
}

export function withKept(record: RunRecord, userId: number | null, team: boolean, keep: boolean): RunRecord {
  if (!team) return { ...record, favorite: keep };
  if (userId == null) return record;
  const ids = record.favoriteUserIds ?? [];
  const next = keep ? (ids.includes(userId) ? ids : [...ids, userId]) : ids.filter((id) => id !== userId);
  return { ...record, favoriteUserIds: next };
}

/** Creator dropdown. "all" keeps every row. A running row that has not been stamped yet still belongs to the signed-in member, so their filter and All keep the loading tile. */
export function matchesAuthor(record: RunRecord, author: string, viewerName: string | null): boolean {
  if (author === "all") return true;
  if (record.createdBy === author) return true;
  return (
    record.status === "running" &&
    !record.createdBy &&
    viewerName != null &&
    author === viewerName
  );
}

/** Team refresh must not replace this member's favorite mark with another member's shared `favorite` flag. */
export function mergeTeamFavorite(local: RunRecord | undefined, remote: RunRecord, userId: number | null): RunRecord {
  const ids = new Set(remote.favoriteUserIds ?? []);
  if (userId != null && local) {
    if (local.favoriteUserIds?.includes(userId)) ids.add(userId);
    else ids.delete(userId);
  }
  const favoriteUserIds = [...ids];
  const next: RunRecord = { ...remote };
  delete next.favorite;
  return favoriteUserIds.length > 0 ? { ...next, favoriteUserIds } : next;
}

export function timeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

/* One step along the runs the visitor is actually looking at, or null at the
   ends — the walk stops there rather than wrapping, so the edge of the scope
   can be felt. A run that has left the list steps nowhere. */
export function stepRun(records: RunRecord[], id: string, delta: number): RunRecord | null {
  const from = records.findIndex((record) => record.id === id);
  if (from < 0) return null;
  return records[from + delta] ?? null;
}
