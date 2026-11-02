import { unlink } from "fs/promises";

import type { RowDataPacket } from "mysql2/promise";

import { requireActiveUser } from "@/auth/guard";
import { getPool, queryRows } from "@/db/client";
import { isRunRecord, type RunRecord } from "@/openhiggsfield/history";

import { uploadFilePath, uploadIdFrom, uploadTypePath } from "./local-upload";

export const TRASH_DAYS = 10;

export type TrashReason = "expired" | "manual";

export type GalleryTrashItem = {
  record: RunRecord;
  expiresAt: number;
};

type TrashRow = RowDataPacket & {
  client_id: string;
  payload: unknown;
  expires_at: Date | string;
};

type PayloadRow = RowDataPacket & {
  payload: unknown;
};

export async function listGalleryTrash(): Promise<GalleryTrashItem[]> {
  const user = await requireActiveUser();
  await purgeGalleryTrashFor(user.id, { reason: "expired" });
  const rows = await queryRows<TrashRow>(
    `SELECT client_id, payload, expires_at FROM gallery_trash
     WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP
     ORDER BY expires_at ASC`,
    [user.id],
  );
  const items: GalleryTrashItem[] = [];
  for (const row of rows) {
    const record = parsePayload(row.payload);
    if (!isRunRecord(record)) continue;
    items.push({ record, expiresAt: new Date(row.expires_at).getTime() });
  }
  return items;
}

export async function discardGalleryTrash(clientIds: string[]): Promise<void> {
  const user = await requireActiveUser();
  const ids = [...new Set(clientIds.map((id) => id.slice(0, 191)).filter(Boolean))];
  if (ids.length === 0) return;
  await purgeGalleryTrashFor(user.id, { reason: "manual", clientIds: ids });
}

/** Deletes trash rows, then local media that no remaining gallery or trash row still uses. */
export async function purgeGalleryTrashFor(
  userId: number,
  input: { reason: TrashReason; clientIds?: string[] },
): Promise<void> {
  const connection = await getPool().getConnection();
  let removed: TrashRow[] = [];
  try {
    await connection.beginTransaction();
    if (input.reason === "expired") {
      const [rows] = await connection.query<TrashRow[]>(
        `SELECT client_id, payload, expires_at FROM gallery_trash
         WHERE user_id = ? AND expires_at <= CURRENT_TIMESTAMP`,
        [userId],
      );
      removed = rows;
      if (rows.length > 0) {
        await connection.query(
          `DELETE FROM gallery_trash WHERE user_id = ? AND expires_at <= CURRENT_TIMESTAMP`,
          [userId],
        );
      }
    } else {
      const ids = input.clientIds ?? [];
      if (ids.length === 0) {
        await connection.commit();
        return;
      }
      const marks = ids.map(() => "?").join(", ");
      const [rows] = await connection.query<TrashRow[]>(
        `SELECT client_id, payload, expires_at FROM gallery_trash
         WHERE user_id = ? AND client_id IN (${marks})`,
        [userId, ...ids],
      );
      removed = rows;
      if (rows.length > 0) {
        await connection.query(
          `DELETE FROM gallery_trash WHERE user_id = ? AND client_id IN (${marks})`,
          [userId, ...ids],
        );
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error("[gallery-trash] purge failed", error instanceof Error ? error.message : error);
    throw error;
  } finally {
    connection.release();
  }

  if (removed.length === 0) return;

  try {
    const media = await deleteUnsharedMedia(userId, removed);
    console.info("[gallery-trash] purged", {
      userId,
      reason: input.reason,
      clientIds: removed.map((row) => row.client_id),
      filesRemoved: media.filesRemoved,
      filesMissing: media.filesMissing,
      filesKeptShared: media.filesKeptShared,
    });
  } catch (error) {
    console.error("[gallery-trash] purge failed", error instanceof Error ? error.message : error);
    throw error;
  }
}

async function deleteUnsharedMedia(
  userId: number,
  removed: TrashRow[],
): Promise<{ filesRemoved: string[]; filesMissing: string[]; filesKeptShared: string[] }> {
  const wanted = new Set<string>();
  for (const row of removed) {
    const record = parsePayload(row.payload);
    if (!isRunRecord(record)) continue;
    for (const id of uploadIdsOf(record)) wanted.add(id);
  }

  const filesRemoved: string[] = [];
  const filesMissing: string[] = [];
  const filesKeptShared: string[] = [];
  if (wanted.size === 0) return { filesRemoved, filesMissing, filesKeptShared };

  const stillUsed = await referencedUploadIds(userId);
  for (const id of wanted) {
    if (stillUsed.has(id)) {
      filesKeptShared.push(id);
      continue;
    }
    const status = await removeUploadFiles(id);
    if (status === "removed") filesRemoved.push(id);
    else filesMissing.push(id);
  }
  return { filesRemoved, filesMissing, filesKeptShared };
}

async function referencedUploadIds(userId: number): Promise<Set<string>> {
  const rows = await queryRows<PayloadRow>(
    `SELECT payload FROM generation_results WHERE user_id = ?
     UNION ALL
     SELECT payload FROM gallery_trash WHERE user_id = ?`,
    [userId, userId],
  );
  const ids = new Set<string>();
  for (const row of rows) {
    const record = parsePayload(row.payload);
    if (!isRunRecord(record)) continue;
    for (const id of uploadIdsOf(record)) ids.add(id);
  }
  return ids;
}

function uploadIdsOf(record: RunRecord): string[] {
  const ids: string[] = [];
  for (const url of [...record.urls, ...(record.remoteUrls ?? [])]) {
    const id = uploadIdFrom(url);
    if (id) ids.push(id);
  }
  return ids;
}

async function removeUploadFiles(id: string): Promise<"removed" | "missing"> {
  let removed = false;
  let missing = 0;
  for (const file of [uploadFilePath(id), uploadTypePath(id)]) {
    try {
      await unlink(file);
      removed = true;
    } catch (caught) {
      const code = caught && typeof caught === "object" && "code" in caught ? caught.code : "";
      if (code === "ENOENT") missing += 1;
      else throw caught;
    }
  }
  if (removed) return "removed";
  if (missing === 2) return "missing";
  return "missing";
}

function parsePayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
}
