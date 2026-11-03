import type { RowDataPacket } from "mysql2/promise";

import { requireActiveUser } from "@/auth/guard";
import { getPool, queryRows } from "@/db/client";
import { capHistory, isRunRecord, type RunRecord } from "@/openhiggsfield/history";

import { archiveRunRecord } from "./archive-media";
import { listActiveJobIds } from "./api-jobs";
import { purgeGalleryTrashFor, TRASH_DAYS } from "./gallery-trash";
import { kickSettle } from "./settle";

type ResultRow = RowDataPacket & {
  client_id?: string;
  payload: unknown;
};

export async function listGenerationResults(): Promise<RunRecord[]> {
  const user = await requireActiveUser();
  /* Opening the studio is a good moment to finish whatever the server is still
     following, so a run that completed while nobody watched is already here
     instead of waiting for the next worker tick. */
  kickSettle(user.id);
  return listGenerationResultsFor(user.id);
}

/** Unauthenticated twin, for scripts and tests that already know the owner. */
export async function listGenerationResultsFor(userId: number): Promise<RunRecord[]> {
  const rows = await queryRows<ResultRow>(
    `SELECT payload FROM generation_results WHERE user_id = ?`,
    [userId],
  );
  const records = rows.map((row) => parsePayload(row.payload)).filter(isRunRecord);
  records.sort((a, b) => b.createdAt - a.createdAt);
  return capHistory(records);
}

/** Replaces this account's gallery rows with the given list, including removals.
    The studio only calls this after it has loaded the server list, so an API row
    (`#api`) missing from that list was deleted by the user and moves to Temp.
    API rows still in the list are upserted, not wiped and rewritten in bulk. */
export async function replaceGenerationResults(records: RunRecord[]): Promise<RunRecord[]> {
  const user = await requireActiveUser();
  return replaceGenerationResultsFor(user.id, records);
}

/** Unauthenticated twin, for scripts and tests that already know the owner. */
export async function replaceGenerationResultsFor(userId: number, records: RunRecord[]): Promise<RunRecord[]> {
  const incoming = capHistory(records.filter(isRunRecord));
  const next = await Promise.all(incoming.map((record) => archiveRunRecord(userId, record)));
  const kept = new Set(next.map((record) => record.id.slice(0, 191)));
  /* A row the server is still following but this browser has not seen yet is
     not a deletion: it belongs to a job in flight, and the settlement worker
     writes its finished copy under the same id. Dropping it here would move a
     running generation to Temp behind the visitor's back. */
  const moving = await listActiveJobIds(userId).catch(() => new Set<string>());
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query<ResultRow[]>(
      `SELECT client_id, payload FROM generation_results WHERE user_id = ?`,
      [userId],
    );
    const dropped: string[] = [];
    for (const row of existing) {
      if (!row.client_id || kept.has(row.client_id) || moving.has(row.client_id)) continue;
      dropped.push(row.client_id);
      await connection.query(
        `INSERT INTO gallery_trash (user_id, client_id, payload, deleted_at, expires_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${TRASH_DAYS} DAY))
         ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
        [userId, row.client_id, JSON.stringify(parsePayload(row.payload) ?? row.payload)],
      );
    }
    if (dropped.length > 0) {
      const marks = dropped.map(() => "?").join(", ");
      await connection.query(
        `DELETE FROM generation_results WHERE user_id = ? AND client_id IN (${marks})`,
        [userId, ...dropped],
      );
    }
    if (kept.size > 0) {
      const marks = [...kept].map(() => "?").join(", ");
      await connection.query(
        `DELETE FROM gallery_trash WHERE user_id = ? AND client_id IN (${marks})`,
        [userId, ...kept],
      );
    }
    const protectedMarks = [...moving];
    const keepMoving = protectedMarks.length
      ? ` AND client_id NOT IN (${protectedMarks.map(() => "?").join(", ")})`
      : "";
    await connection.query(
      `DELETE FROM generation_results WHERE user_id = ? AND client_id NOT LIKE '%#api'${keepMoving}`,
      [userId, ...protectedMarks],
    );
    for (const record of next) {
      await connection.query(
        `INSERT INTO generation_results (user_id, client_id, payload) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
        [userId, record.id.slice(0, 191), JSON.stringify(record)],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await purgeGalleryTrashFor(userId, { reason: "expired" });
  return next;
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
