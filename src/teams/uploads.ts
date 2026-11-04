import { readSession } from "@/auth/session";
import { execute, queryOne } from "@/db/client";
import type { RowDataPacket } from "mysql2/promise";

import { workspaceFor } from "./access";
import { membership } from "./store";

export async function registerUpload(input: {
  id: string;
  userId: number;
  filename: string;
  mime: string;
}): Promise<void> {
  const session = await readSession();
  const workspace = session && session.id === input.userId ? await workspaceFor(session) : null;
  await execute(
    `INSERT INTO uploads (id, team_id, created_by, filename, mime) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE filename = VALUES(filename)`,
    [input.id, workspace?.teamId ?? null, input.userId, input.filename.slice(0, 255), input.mime.slice(0, 128)],
  );
}

/** Legacy files with no registry row stay readable by any signed-in studio session. */
export async function uploadVisible(id: string, userId: number): Promise<boolean> {
  const row = await queryOne<RowDataPacket & { team_id: number | null; created_by: number }>(
    `SELECT team_id, created_by FROM uploads WHERE id = ?`,
    [id],
  );
  if (!row) return true;
  if (row.team_id == null) return Number(row.created_by) === userId;
  return (await membership(Number(row.team_id), userId)) !== null;
}
