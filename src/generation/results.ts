import type { RowDataPacket } from "mysql2/promise";

import { requireActiveUser } from "@/auth/guard";
import { getPool, queryRows } from "@/db/client";
import { capHistory, isRunRecord, type RunRecord } from "@/openhiggsfield/history";

type ResultRow = RowDataPacket & {
  payload: unknown;
};

export async function listGenerationResults(): Promise<RunRecord[]> {
  const user = await requireActiveUser();
  return listGenerationResultsFor(user.id);
}

/** Unauthenticated twin, for scripts and tests that already know the owner. */
export async function listGenerationResultsFor(userId: number): Promise<RunRecord[]> {
  const rows = await queryRows<ResultRow>(
    `SELECT payload FROM generation_results WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId],
  );
  return capHistory(rows.map((row) => parsePayload(row.payload)).filter(isRunRecord));
}

/** Replaces this account's browser-owned gallery rows with the given list,
    including removals. Rows that came from /api/v1 are *not* touched: they have
    no browser copy, so a client that has not seen one yet would otherwise delete
    the only record of a paid generation. */
export async function replaceGenerationResults(records: RunRecord[]): Promise<void> {
  const user = await requireActiveUser();
  await replaceGenerationResultsFor(user.id, records);
}

/** Unauthenticated twin, for scripts and tests that already know the owner. */
export async function replaceGenerationResultsFor(userId: number, records: RunRecord[]): Promise<void> {
  const next = capHistory(records.filter(isRunRecord));
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM generation_results WHERE user_id = ? AND client_id NOT LIKE '%#api'`, [
      userId,
    ]);
    for (const record of next) {
      if (record.via === "api") continue;
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
