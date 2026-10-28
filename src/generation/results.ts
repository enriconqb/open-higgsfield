import type { RowDataPacket } from "mysql2/promise";

import { requireActiveUser } from "@/auth/guard";
import { getPool, queryRows } from "@/db/client";
import { capHistory, isRunRecord, type RunRecord } from "@/openhiggsfield/history";

type ResultRow = RowDataPacket & {
  payload: unknown;
};

export async function listGenerationResults(): Promise<RunRecord[]> {
  const user = await requireActiveUser();
  const rows = await queryRows<ResultRow>(
    `SELECT payload FROM generation_results WHERE user_id = ? ORDER BY updated_at DESC`,
    [user.id],
  );
  return capHistory(rows.map((row) => parsePayload(row.payload)).filter(isRunRecord));
}

/** Replaces this account's gallery with the given rows, including removals. */
export async function replaceGenerationResults(records: RunRecord[]): Promise<void> {
  const user = await requireActiveUser();
  const next = capHistory(records.filter(isRunRecord));
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM generation_results WHERE user_id = ?`, [user.id]);
    for (const record of next) {
      await connection.query(
        `INSERT INTO generation_results (user_id, client_id, payload) VALUES (?, ?, ?)`,
        [user.id, record.id.slice(0, 191), JSON.stringify(record)],
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
