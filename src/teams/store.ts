import type { RowDataPacket } from "mysql2/promise";

import { execute, queryOne, queryRows } from "@/db/client";

import type { AuditRow, BillingMode, InviteStatus, LedgerRow, TeamMemberView, TeamRole, TeamSummary } from "./types";

type TeamPacket = RowDataPacket & {
  id: number;
  name: string;
  status: "active" | "disabled";
  billing_mode: BillingMode;
  role: TeamRole;
};

export async function listTeamsForUser(userId: number): Promise<TeamSummary[]> {
  const rows = await queryRows<TeamPacket>(
    `SELECT t.id, t.name, t.status, t.billing_mode, m.role
     FROM team_members m
     INNER JOIN teams t ON t.id = m.team_id
     WHERE m.user_id = ? AND t.status = 'active'
     ORDER BY t.name`,
    [userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    status: row.status,
    billingMode: row.billing_mode,
    role: row.role,
  }));
}

export async function membership(
  teamId: number,
  userId: number,
): Promise<{ role: TeamRole; status: "active" | "disabled"; billingMode: BillingMode; name: string } | null> {
  const row = await queryOne<TeamPacket>(
    `SELECT t.id, t.name, t.status, t.billing_mode, m.role
     FROM team_members m
     INNER JOIN teams t ON t.id = m.team_id
     WHERE m.team_id = ? AND m.user_id = ?`,
    [teamId, userId],
  );
  if (!row) return null;
  return { role: row.role, status: row.status, billingMode: row.billing_mode, name: row.name };
}

export async function insertAudit(teamId: number, actorId: number | null, action: string, detail: string): Promise<void> {
  await execute(
    `INSERT INTO team_audit_log (team_id, actor_id, action, detail) VALUES (?, ?, ?, ?)`,
    [teamId, actorId, action.slice(0, 64), detail.slice(0, 255)],
  );
}

export async function listAudit(teamId: number): Promise<AuditRow[]> {
  const rows = await queryRows<RowDataPacket & { id: number; action: string; detail: string; username: string | null; created_at: Date }>(
    `SELECT a.id, a.action, a.detail, u.username, a.created_at
     FROM team_audit_log a
     LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.team_id = ?
     ORDER BY a.id DESC
     LIMIT 40`,
    [teamId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    detail: row.detail,
    actor: row.username ?? "",
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function listMembers(teamId: number): Promise<TeamMemberView[]> {
  const rows = await queryRows<
    RowDataPacket & {
      user_id: number;
      username: string;
      role: TeamRole;
      own_key: number;
      team_key: number;
      limit_usd: number | null;
      spent_usd: number | null;
    }
  >(
    `SELECT m.user_id, u.username, m.role,
            (k.user_id IS NOT NULL) AS own_key,
            (tk.user_id IS NOT NULL) AS team_key,
            a.limit_usd, a.spent_usd
     FROM team_members m
     INNER JOIN users u ON u.id = m.user_id
     LEFT JOIN user_api_keys k ON k.user_id = m.user_id
     LEFT JOIN team_member_keys tk ON tk.team_id = m.team_id AND tk.user_id = m.user_id
     LEFT JOIN team_member_allowances a ON a.team_id = m.team_id AND a.user_id = m.user_id
     INNER JOIN teams t ON t.id = m.team_id
     WHERE m.team_id = ?
     ORDER BY (m.user_id = t.api_user_id) DESC, (m.role = 'team_admin') DESC, u.username ASC`,
    [teamId],
  );
  return rows.map((row) => ({
    userId: Number(row.user_id),
    username: row.username,
    role: row.role,
    hasOwnKey: Number(row.own_key) === 1,
    hasTeamKey: Number(row.team_key) === 1,
    limitCredits: Number(row.limit_usd ?? 0),
    spentCredits: Number(row.spent_usd ?? 0),
  }));
}

export async function findUserIdByUsername(username: string): Promise<{ id: number; status: string } | null> {
  const row = await queryOne<RowDataPacket & { id: number; status: string }>(
    `SELECT id, status FROM users WHERE username = ?`,
    [username],
  );
  if (!row) return null;
  return { id: Number(row.id), status: row.status };
}

export function inviteExpiry(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

export async function expireStaleInvites(): Promise<void> {
  await execute(
    `UPDATE team_invites SET status = 'expired' WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP`,
  );
}

export async function pendingInvitesFor(username: string): Promise<
  { id: number; teamId: number; teamName: string; invitedBy: string; expiresAt: Date }[]
> {
  await expireStaleInvites();
  const rows = await queryRows<
    RowDataPacket & { id: number; team_id: number; name: string; invited_by_name: string; expires_at: Date }
  >(
    `SELECT i.id, i.team_id, t.name, u.username AS invited_by_name, i.expires_at
     FROM team_invites i
     INNER JOIN teams t ON t.id = i.team_id
     INNER JOIN users u ON u.id = i.invited_by
     WHERE i.username = ? AND i.status = 'pending' AND t.status = 'active'`,
    [username],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    teamId: Number(row.team_id),
    teamName: row.name,
    invitedBy: row.invited_by_name,
    expiresAt: new Date(row.expires_at),
  }));
}

export async function countUnreadCreditAlerts(teamId: number): Promise<number> {
  const row = await queryOne<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM team_credit_alerts
     WHERE team_id = ? AND read_at IS NULL AND kind IN ('exhausted', 'member_limit')`,
    [teamId],
  );
  return Number(row?.total ?? 0);
}

export async function listLedger(teamId: number): Promise<LedgerRow[]> {
  const rows = await queryRows<
    RowDataPacket & {
      id: number;
      kind: string;
      amount_usd: number;
      before_usd: number;
      after_usd: number;
      username: string | null;
      note: string;
      created_at: Date;
    }
  >(
    `SELECT l.id, l.kind, l.amount_usd, l.before_usd, l.after_usd, u.username, l.note, l.created_at
     FROM team_credit_ledger l
     LEFT JOIN users u ON u.id = l.actor_id
     WHERE l.team_id = ?
     ORDER BY l.id DESC
     LIMIT 30`,
    [teamId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    credits: Number(row.amount_usd),
    beforeCredits: Number(row.before_usd),
    afterCredits: Number(row.after_usd),
    username: row.username ?? "",
    note: row.note,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

/** NULL is the personal workspace. Written on every switch so the next login, on any device, opens the same place. */
export async function rememberWorkspace(userId: number, teamId: number | null): Promise<void> {
  await execute(`UPDATE users SET last_team_id = ? WHERE id = ?`, [teamId, userId]);
}

/** Last workspace, or null when it was personal, the team is gone, or the user is no longer a member. */
export async function rememberedWorkspace(userId: number): Promise<number | null> {
  const row = await queryOne<RowDataPacket & { last_team_id: number | null }>(
    `SELECT last_team_id FROM users WHERE id = ?`,
    [userId],
  );
  const teamId = row?.last_team_id == null ? null : Number(row.last_team_id);
  if (!teamId) return null;
  const rowMembership = await membership(teamId, userId);
  if (!rowMembership || rowMembership.status !== "active") {
    await rememberWorkspace(userId, null);
    return null;
  }
  return teamId;
}

export type { InviteStatus, TeamRole };
