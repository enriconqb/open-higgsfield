import type { RowDataPacket } from "mysql2/promise";

import { requireActiveUser } from "@/auth/guard";
import { getPool, queryOne, queryRows } from "@/db/client";
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
  const { workspaceFor } = await import("@/teams/access");
  const workspace = await workspaceFor(user);
  if (workspace.teamId) return listGenerationResultsForTeam(workspace.teamId);
  return listGenerationResultsFor(user.id);
}

async function listGenerationResultsForTeam(teamId: number): Promise<RunRecord[]> {
  const rows = await queryRows<ResultRow & { username?: string }>(
    `SELECT g.payload, u.username
     FROM generation_results g
     LEFT JOIN users u ON u.id = g.created_by
     WHERE g.team_id = ?`,
    [teamId],
  );
  const records = rows.map((row) => stampCreator(parsePayload(row.payload), row.username)).filter(isRunRecord);
  records.sort((a, b) => b.createdAt - a.createdAt);
  return capHistory(records);
}

/** Unauthenticated twin, for scripts and tests that already know the owner. */
export async function listGenerationResultsFor(userId: number): Promise<RunRecord[]> {
  const rows = await queryRows<ResultRow>(
    `SELECT payload FROM generation_results WHERE user_id = ? AND team_id IS NULL`,
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
  const { workspaceFor } = await import("@/teams/access");
  const workspace = await workspaceFor(user);
  return replaceGenerationResultsFor(user.id, records, workspace.teamId);
}

/** Unauthenticated twin, for scripts and tests that already know the owner. */
export async function replaceGenerationResultsFor(
  userId: number,
  records: RunRecord[],
  teamId: number | null = null,
): Promise<RunRecord[]> {
  const incoming = capHistory(records.filter(isRunRecord));
  const next = await Promise.all(
    incoming.map(async (record) => {
      const archived = await archiveRunRecord(userId, record);
      if (teamId && !archived.createdBy) {
        const owner = await queryOne<{ username: string } & import("mysql2/promise").RowDataPacket>(
          `SELECT username FROM users WHERE id = ?`,
          [userId],
        );
        return { ...archived, createdBy: owner?.username };
      }
      return archived;
    }),
  );
  const publish = await teamPublishable(next, userId, teamId);
  const kept = new Set(publish.map((record) => record.id.slice(0, 191)));
  const scope = teamId == null ? `user_id = ? AND team_id IS NULL` : `user_id = ? AND team_id = ?`;
  const scopeParams = teamId == null ? [userId] : [userId, teamId];
  /* A row the server is still following but this browser has not seen yet is
     not a deletion: it belongs to a job in flight, and the settlement worker
     writes its finished copy under the same id. Dropping it here would move a
     running generation to Temp behind the visitor's back. */
  const moving = await listActiveJobIds(userId).catch(() => new Set<string>());
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query<ResultRow[]>(
      `SELECT client_id, payload FROM generation_results WHERE ${scope}`,
      scopeParams,
    );
    const dropped: string[] = [];
    for (const row of existing) {
      if (!row.client_id || kept.has(row.client_id) || moving.has(row.client_id)) continue;
      dropped.push(row.client_id);
      await connection.query(
        `INSERT INTO gallery_trash (user_id, team_id, created_by, client_id, payload, deleted_at, expires_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${TRASH_DAYS} DAY))
         ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
        [userId, teamId, userId, row.client_id, JSON.stringify(parsePayload(row.payload) ?? row.payload)],
      );
    }
    if (dropped.length > 0) {
      const marks = dropped.map(() => "?").join(", ");
      await connection.query(
        `DELETE FROM generation_results WHERE ${scope} AND client_id IN (${marks})`,
        [...scopeParams, ...dropped],
      );
    }
    if (kept.size > 0) {
      const marks = [...kept].map(() => "?").join(", ");
      const trashScope = teamId == null ? scope : `team_id = ?`;
      const trashParams = teamId == null ? scopeParams : [teamId];
      await connection.query(
        `DELETE FROM gallery_trash WHERE ${trashScope} AND client_id IN (${marks})`,
        [...trashParams, ...kept],
      );
    }
    const protectedMarks = [...moving];
    const keepMoving = protectedMarks.length
      ? ` AND client_id NOT IN (${protectedMarks.map(() => "?").join(", ")})`
      : "";
    await connection.query(
      `DELETE FROM generation_results WHERE ${scope} AND client_id NOT LIKE '%#api'${keepMoving}`,
      [...scopeParams, ...protectedMarks],
    );
    for (const record of publish) {
      await connection.query(
        `INSERT INTO generation_results (user_id, team_id, created_by, client_id, payload) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), team_id = VALUES(team_id), created_by = COALESCE(generation_results.created_by, VALUES(created_by)), updated_at = CURRENT_TIMESTAMP`,
        [userId, teamId, userId, record.id.slice(0, 191), JSON.stringify(record)],
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
  return publish;
}

/** Moves team gallery rows into Temp for every member, whoever created them. */
export async function trashTeamResults(clientIds: string[]): Promise<void> {
  const user = await requireActiveUser();
  const { workspaceFor } = await import("@/teams/access");
  const workspace = await workspaceFor(user);
  if (!workspace.teamId) return;
  const ids = uniqueIds(clientIds);
  if (ids.length === 0) return;
  const marks = ids.map(() => "?").join(", ");
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<(ResultRow & { user_id: number; created_by: number | null })[]>(
      `SELECT user_id, created_by, client_id, payload FROM generation_results
       WHERE team_id = ? AND client_id IN (${marks})`,
      [workspace.teamId, ...ids],
    );
    for (const row of rows) {
      await connection.query(
        `INSERT INTO gallery_trash (user_id, team_id, created_by, client_id, payload, deleted_at, expires_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${TRASH_DAYS} DAY))
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), team_id = VALUES(team_id), deleted_at = CURRENT_TIMESTAMP,
           expires_at = VALUES(expires_at)`,
        [row.user_id, workspace.teamId, row.created_by, row.client_id, JSON.stringify(parsePayload(row.payload) ?? row.payload)],
      );
    }
    await connection.query(
      `DELETE FROM generation_results WHERE team_id = ? AND client_id IN (${marks})`,
      [workspace.teamId, ...ids],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const { notifyTeamGallery } = await import("./gallery-signal");
  notifyTeamGallery(workspace.teamId);
}

/** Puts Temp rows back on the team gallery and removes them from Temp. */
export async function restoreTeamResults(clientIds: string[]): Promise<void> {
  const user = await requireActiveUser();
  const { workspaceFor } = await import("@/teams/access");
  const workspace = await workspaceFor(user);
  if (!workspace.teamId) return;
  const ids = uniqueIds(clientIds);
  if (ids.length === 0) return;
  const marks = ids.map(() => "?").join(", ");
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<(ResultRow & { user_id: number; created_by: number | null })[]>(
      `SELECT user_id, created_by, client_id, payload FROM gallery_trash
       WHERE team_id = ? AND client_id IN (${marks})`,
      [workspace.teamId, ...ids],
    );
    for (const row of rows) {
      await connection.query(
        `INSERT INTO generation_results (user_id, team_id, created_by, client_id, payload)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), team_id = VALUES(team_id), updated_at = CURRENT_TIMESTAMP`,
        [row.user_id, workspace.teamId, row.created_by, row.client_id, JSON.stringify(parsePayload(row.payload) ?? row.payload)],
      );
    }
    await connection.query(
      `DELETE FROM gallery_trash WHERE team_id = ? AND client_id IN (${marks})`,
      [workspace.teamId, ...ids],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const { notifyTeamGallery } = await import("./gallery-signal");
  notifyTeamGallery(workspace.teamId);
}

async function teamPublishable(records: RunRecord[], userId: number, teamId: number | null): Promise<RunRecord[]> {
  if (!teamId || records.length === 0) return records;
  const ids = records.map((record) => record.id.slice(0, 191));
  const marks = ids.map(() => "?").join(", ");
  const trashed = await queryRows<ResultRow & { client_id: string }>(
    `SELECT client_id FROM gallery_trash WHERE team_id = ? AND client_id IN (${marks})`,
    [teamId, ...ids],
  );
  const foreign = await queryRows<ResultRow & { client_id: string }>(
    `SELECT client_id FROM generation_results WHERE team_id = ? AND user_id <> ? AND client_id IN (${marks})`,
    [teamId, userId, ...ids],
  );
  const skip = new Set([...trashed, ...foreign].map((row) => row.client_id));
  return records.filter((record) => !skip.has(record.id.slice(0, 191)));
}

function uniqueIds(clientIds: string[]): string[] {
  return [...new Set(clientIds.map((id) => id.slice(0, 191)).filter(Boolean))];
}

function stampCreator(payload: unknown, username: string | undefined): unknown {
  if (!username || !payload || typeof payload !== "object") return payload;
  const record = payload as RunRecord;
  if (record.createdBy) return record;
  return { ...record, createdBy: username };
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
