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
  /** Resolved catalog settings this run was submitted with, so reuse can
      restore the dials and not just the words. Absent on pre-existing records. */
  settings?: Record<string, unknown>;
  /** USD charged or estimated for this result. Absent on older records. */
  costUsd?: number;
  /** Present only on rows produced through /api/v1 with a bearer token, so the
      studio can label them apart from browser runs. */
  via?: "api";
  /** Which API token produced the row, when one did. */
  tokenId?: number | null;
}

export const HISTORY_KEY = "history.v1";
export const LEGACY_HISTORY_KEY = "openhiggsfield.history.v1";
const MAX_RECORDS = 60;

export function historyKeyFor(userId: number): string {
  return `${HISTORY_KEY}.${userId}`;
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
  const next = capHistory(records.filter(isRunRecord));
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
  return capHistory([...byId.values()].sort((a, b) => b.createdAt - a.createdAt));
}

async function readIdb(kv: Kv, key: string): Promise<RunRecord[]> {
  try {
    const stored = await kv.get<unknown>(key);
    if (!Array.isArray(stored)) return [];
    return capHistory(stored.filter(isRunRecord));
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
    return capHistory(parsed.filter(isRunRecord));
  } catch {
    return [];
  }
}

/* The cap trims the run log, not the visitor's shelf: a favorite is a
   deliberate keep, so only unmarked runs age out of the window. */
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
  return capHistory(
    [...next, ...records.filter((record) => requestIdOf(record) !== requestId)].sort(
      (a, b) => b.createdAt - a.createdAt,
    ),
  );
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
    (record.settings === undefined ||
      (typeof record.settings === "object" && record.settings !== null)) &&
    (record.costUsd === undefined || typeof record.costUsd === "number") &&
    (record.via === undefined || record.via === "api") &&
    (record.tokenId === undefined || record.tokenId === null || typeof record.tokenId === "number")
  );
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
