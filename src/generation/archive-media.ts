import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "fs/promises";

import type { RunRecord } from "@/openhiggsfield/history";

import { sniffImageMime, uploadFilePath, uploadMaxBytes, uploadRoot, uploadTypePath } from "./local-upload";

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

const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i;

/** Bytes of a browser data-image URL, or null when it is not a still we store. */
export function dataImageBytes(url: string): { bytes: Buffer; mime: string } | null {
  const match = DATA_IMAGE.exec(url.trim());
  if (!match?.[1]) return null;
  const bytes = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  if (!bytes.byteLength) return null;
  const mime = sniffImageMime(bytes);
  if (!mime) return null;
  return { bytes, mime };
}

function uploadIdFromHash(bytes: Buffer): string {
  const hex = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function writeArchive(id: string, bytes: Buffer, mime: string): Promise<string> {
  const type = mime.split(";")[0]?.trim() || "application/octet-stream";
  await mkdir(uploadRoot(), { recursive: true });
  await writeFile(uploadFilePath(id), bytes);
  await writeFile(uploadTypePath(id), type);
  return uploadPublicPath(id);
}

/** Stores a data-image that never went through the status archive (an older
    gallery row). Throws when the still is larger than the upload cap. */
export async function archiveInlineImage(dataUrl: string): Promise<string> {
  const parsed = dataImageBytes(dataUrl);
  if (!parsed) throw new Error("This result cannot be shared yet");
  if (parsed.bytes.byteLength > uploadMaxBytes()) throw new Error("This image is too large to share");
  const id = uploadIdFromHash(parsed.bytes);
  try {
    await access(uploadFilePath(id));
    return uploadPublicPath(id);
  } catch {
    return writeArchive(id, parsed.bytes, parsed.mime);
  }
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
  const inline = dataImageBytes(url);
  const remote = /^https?:\/\//i.test(url);
  if (!remote && !inline && !input.fetchBytes) return url;
  if (inline && inline.bytes.byteLength > uploadMaxBytes()) return url;

  const id = inline ? uploadIdFromHash(inline.bytes) : durableUploadId(input.userId, input.requestId, input.index);
  try {
    await access(uploadFilePath(id));
    return uploadPublicPath(id);
  } catch {
    /* not on disk yet */
  }

  try {
    let bytes: Buffer;
    let mime = input.mime || "application/octet-stream";
    if (inline) {
      bytes = inline.bytes;
      mime = inline.mime;
    } else if (!remote && input.fetchBytes) {
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
    return await writeArchive(id, bytes, mime);
  } catch (caught) {
    console.error("[archive] failed", caught instanceof Error ? caught.message : caught);
    return url;
  }
}

/** Rewrites completed run URLs to the local copy. The https URL each one
    replaced is kept beside it — for images as well as video — so a reference can
    still be sent to a provider, and the gallery can prefer the CDN while it
    lasts and fall back to the disk copy after. */
export async function archiveRunRecord(userId: number, record: RunRecord): Promise<RunRecord> {
  if (record.status !== "completed" || record.urls.length === 0) return record;
  const requestId = record.requestId ?? record.id.split("#")[0] ?? record.id;
  const video = record.kind === "video" || record.surface === "video";
  const mime = video ? "video/mp4" : "image/png";
  const urls = await Promise.all(
    record.urls.map((url, index) => ensureArchivedUrl({ url, userId, requestId, index, mime })),
  );
  const remoteUrls = keptRemoteUrls(record, urls);
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
