import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "fs/promises";

import type { RunRecord } from "@/openhiggsfield/history";

import { uploadFilePath, uploadRoot, uploadTypePath } from "./local-upload";

const ARCHIVE_TIMEOUT_MS = 120_000;

/** Stable file id so a second poll of the same result does not download again. */
export function durableUploadId(userId: number, requestId: string, index: number): string {
  const hex = createHash("sha256").update(`${userId}\0${requestId}\0${index}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uploadPublicPath(id: string): string {
  return `/api/uploads/${id}`;
}

export function isArchivedMediaUrl(url: string): boolean {
  return /\/(?:api\/)?uploads\/[0-9a-f-]{36}/i.test(url);
}

/** Downloads a remote result into UPLOAD_DIR (or cwd/uploads). Returns the local
    path when the file is on disk, or the original URL when the download fails. */
export async function ensureArchivedUrl(input: {
  url: string;
  userId: number;
  requestId: string;
  index: number;
  mime?: string;
  fetchBytes?: () => Promise<{ bytes: Buffer; mime: string } | null>;
}): Promise<string> {
  const url = input.url;
  if (!url || isArchivedMediaUrl(url)) return url;
  const remote = /^https?:\/\//i.test(url);
  if (!remote && !input.fetchBytes) return url;

  const id = durableUploadId(input.userId, input.requestId, input.index);
  try {
    await access(uploadFilePath(id));
    return uploadPublicPath(id);
  } catch {
    /* not on disk yet */
  }

  try {
    let bytes: Buffer;
    let mime = input.mime || "application/octet-stream";
    if (!remote && input.fetchBytes) {
      const fetched = await input.fetchBytes();
      if (!fetched || !fetched.bytes.byteLength) return url;
      bytes = fetched.bytes;
      mime = fetched.mime || mime;
    } else {
      const response = await fetch(url, { signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS) });
      if (!response.ok) return url;
      bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.byteLength) return url;
      mime = response.headers.get("Content-Type") || mime;
    }
    const type = mime.split(";")[0]?.trim() || "application/octet-stream";
    await mkdir(uploadRoot(), { recursive: true });
    await writeFile(uploadFilePath(id), bytes);
    await writeFile(uploadTypePath(id), type);
    return uploadPublicPath(id);
  } catch (caught) {
    console.error("[archive] failed", caught instanceof Error ? caught.message : caught);
    return url;
  }
}

/** Rewrites completed run URLs to the local copy. A video also keeps the https
    URL it replaced, so a reference can still be sent to the provider. */
export async function archiveRunRecord(userId: number, record: RunRecord): Promise<RunRecord> {
  if (record.status !== "completed" || record.urls.length === 0) return record;
  const requestId = record.requestId ?? record.id.split("#")[0] ?? record.id;
  const video = record.kind === "video" || record.surface === "video";
  const mime = video ? "video/mp4" : "image/png";
  const urls = await Promise.all(
    record.urls.map((url, index) => ensureArchivedUrl({ url, userId, requestId, index, mime })),
  );
  const remoteUrls = video ? keptRemoteUrls(record, urls) : undefined;
  const urlsSame = urls.every((url, index) => url === record.urls[index]);
  const remoteSame = sameList(record.remoteUrls, remoteUrls);
  if (urlsSame && remoteSame) return record;
  return { ...record, urls, ...(remoteUrls ? { remoteUrls } : {}) };
}

function keptRemoteUrls(record: RunRecord, archived: string[]): string[] | undefined {
  const next = archived.map((local, index) => {
    const original = record.urls[index] ?? "";
    if (/^https:\/\//i.test(original) && original !== local) return original;
    const kept = record.remoteUrls?.[index] ?? "";
    if (/^https:\/\//i.test(kept)) return kept;
    return "";
  });
  return next.some((url) => url.startsWith("https://")) ? next : undefined;
}

function sameList(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((url, index) => url === right[index]);
}
