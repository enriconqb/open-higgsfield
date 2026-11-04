"use server";

import { ForbiddenError } from "@/auth/errors";
import { requireActiveUser, requireSuperadmin } from "@/auth/guard";
import { writeSession } from "@/auth/session";
import { hasStudioAdminAccess } from "@/auth/types";
import { getApiKeyRow } from "@/auth/users";
import { execute, queryOne } from "@/db/client";
import type { RowDataPacket } from "mysql2/promise";
import { run, type ActionResult } from "@/lib/action-result";

import { requireTeamRole, workspaceFor } from "./access";
import {
  addGlobal,
  clearOwnerBalance,
  ensureOwnerWallet,
  fundTeam,
  markAlertsRead,
  ownerBillingMode,
  removeBalance,
  setMemberLimit,
  setOwnerBillingMode,
  snapshotFor,
} from "./credits";
import { deleteTeamKey, saveTeamKey, type KeyProvider } from "./keys";
import {
  countUnreadCreditAlerts,
  findUserIdByUsername,
  insertAudit,
  inviteExpiry,
  listAudit,
  listLedger,
  listMembers,
  listTeamsForUser,
  pendingInvitesFor,
  rememberWorkspace,
} from "./store";
import type { AuditRow, CreditSnapshot, LedgerRow, TeamInviteView, TeamMemberView, TeamSummary } from "./types";

export type TeamDesk = {
  teams: TeamSummary[];
  activeTeamId: number | null;
  invites: TeamInviteView[];
  alertCount: number;
  members: TeamMemberView[];
  credit: CreditSnapshot | null;
  ledger: LedgerRow[];
  audit: AuditRow[];
  canAdmin: boolean;
  isSuperadmin: boolean;
  createdBy: number | null;
  apiUserId: number | null;
  viewerId: number;
};

function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a team name");
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 64) throw new Error("Team name must be 2–64 characters");
  return name;
}

export async function loadTeamDesk(): Promise<ActionResult<TeamDesk>> {
  return run(async () => {
    const session = await requireActiveUser();
    const teams = await listTeamsForUser(session.id);
    const workspace = await workspaceFor(session);
    const invites = (await pendingInvitesFor(session.username)).map((row) => ({
      id: row.id,
      teamId: row.teamId,
      teamName: row.teamName,
      invitedBy: row.invitedBy,
      expiresAt: row.expiresAt.toISOString(),
    }));
    const active = workspace.teamId;
    const owner = active
      ? await queryOne<RowDataPacket & { created_by: number }>(`SELECT created_by FROM teams WHERE id = ?`, [active])
      : null;
    const ownKey = (await getApiKeyRow(session.id)) !== null;
    const canAdmin = workspace.role === "team_admin" || hasStudioAdminAccess(session.role);
    return {
      teams,
      activeTeamId: active,
      invites,
      alertCount: active && workspace.role === "team_admin" ? await countUnreadCreditAlerts(active) : 0,
      members: active && canAdmin ? await listMembers(active) : [],
      credit: active ? await snapshotFor(active, session.id, !ownKey) : null,
      ledger: active && canAdmin ? await listLedger(active) : [],
      audit: active && canAdmin ? await listAudit(active) : [],
      canAdmin: Boolean(active && canAdmin),
      isSuperadmin: session.role === "superadmin",
      createdBy: owner?.created_by == null ? null : Number(owner.created_by),
      apiUserId: active ? await teamApiUserId(active) : null,
      viewerId: session.id,
    };
  });
}

export async function switchTeam(teamId: number | null): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    if (teamId == null) {
      await writeSession({ ...session, activeTeamId: null });
      await rememberWorkspace(session.id, null);
      return;
    }
    await requireTeamRole(session, teamId, false);
    await writeSession({ ...session, activeTeamId: teamId });
    await rememberWorkspace(session.id, teamId);
  });
}

export async function createTeam(name: unknown): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    const label = cleanName(name);
    const result = await execute(
      `INSERT INTO teams (name, created_by) VALUES (?, ?)`,
      [label, session.id],
    );
    const teamId = Number(result.insertId);
    await execute(
      `INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'team_admin')`,
      [teamId, session.id],
    );
    await execute(`INSERT IGNORE INTO team_credit_accounts (team_id) VALUES (?)`, [teamId]);
    await insertAudit(teamId, session.id, "create", label);
  });
}

export async function renameTeam(teamId: number, name: unknown): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireSuperadmin();
    const label = cleanName(name);
    await execute(`UPDATE teams SET name = ? WHERE id = ?`, [label, teamId]);
    await insertAudit(teamId, session.id, "rename", label);
  });
}

export async function dissolveTeam(teamId: number, name: unknown): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    if (typeof name !== "string") throw new Error("Type the team name exactly");
    const team = await queryOne<RowDataPacket & { name: string; created_by: number; status: string }>(
      `SELECT name, created_by, status FROM teams WHERE id = ?`,
      [teamId],
    );
    if (!team || team.status !== "active") throw new Error("This team is already dissolved");
    if (name !== team.name) throw new Error("Type the team name exactly");
    const founder = Number(team.created_by) === session.id;
    if (!founder && session.role !== "superadmin") throw new ForbiddenError();
    await execute(`UPDATE teams SET status = 'disabled' WHERE id = ?`, [teamId]);
    await insertAudit(teamId, session.id, "status", "disabled");
    if (session.activeTeamId === teamId) {
      await writeSession({ ...session, activeTeamId: null });
    }
    await execute(
      `UPDATE users SET last_team_id = NULL WHERE last_team_id = ?`,
      [teamId],
    );
  });
}

export async function setTeamStatus(teamId: number, status: "active" | "disabled"): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireSuperadmin();
    await execute(`UPDATE teams SET status = ? WHERE id = ?`, [status, teamId]);
    await insertAudit(teamId, session.id, "status", status);
  });
}

async function requireBalanceOwner(teamId: number): Promise<import("@/auth/types").SessionUser> {
  const session = await requireActiveUser();
  const owner = await teamApiUserId(teamId);
  if (owner !== session.id) throw new ForbiddenError();
  return session;
}

export async function setBillingMode(teamId: number, mode: "global" | "member"): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireBalanceOwner(teamId);
    await setOwnerBillingMode(teamId, session.id, mode);
    await execute(`UPDATE teams SET billing_mode = ? WHERE id = ?`, [mode, teamId]);
    await insertAudit(teamId, session.id, "billing_mode", mode);
    await execute(
      `INSERT INTO team_credit_ledger (team_id, actor_id, kind, note) VALUES (?, ?, 'mode', ?)`,
      [teamId, session.id, mode],
    );
  });
}

export async function inviteMember(teamId: number, username: unknown): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    await requireTeamRole(session, teamId, true);
    if (typeof username !== "string") throw new Error("Enter a username");
    const name = username.trim().toLowerCase();
    const user = await findUserIdByUsername(name);
    if (!user || user.status !== "active") throw new Error("No active account uses that username");
    if (user.id === session.id) throw new Error("You are already in this team");
    const existing = await queryOne<RowDataPacket>(
      `SELECT user_id FROM team_members WHERE team_id = ? AND user_id = ?`,
      [teamId, user.id],
    );
    if (existing) throw new Error("That account is already in this team");
    await execute(
      `INSERT INTO team_invites (team_id, username, invited_by, expires_at) VALUES (?, ?, ?, ?)`,
      [teamId, name, session.id, inviteExpiry()],
    );
    await insertAudit(teamId, session.id, "invite", name);
  });
}

export async function respondInvite(inviteId: number, accept: boolean): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    const row = await queryOne<RowDataPacket & { team_id: number; username: string; status: string }>(
      `SELECT team_id, username, status FROM team_invites WHERE id = ?`,
      [inviteId],
    );
    if (!row || row.username !== session.username || row.status !== "pending") throw new ForbiddenError();
    if (!accept) {
      await execute(`UPDATE team_invites SET status = 'declined' WHERE id = ?`, [inviteId]);
      await insertAudit(Number(row.team_id), session.id, "decline", session.username);
      return;
    }
    await execute(
      `INSERT IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')`,
      [row.team_id, session.id],
    );
    await execute(`UPDATE team_invites SET status = 'accepted' WHERE id = ?`, [inviteId]);
    await insertAudit(Number(row.team_id), session.id, "accept", session.username);
  });
}

export async function revokeInvite(inviteId: number): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    const row = await queryOne<RowDataPacket & { team_id: number }>(
      `SELECT team_id FROM team_invites WHERE id = ? AND status = 'pending'`,
      [inviteId],
    );
    if (!row) throw new Error("Invite is no longer pending");
    await requireTeamRole(session, Number(row.team_id), true);
    await execute(`UPDATE team_invites SET status = 'revoked' WHERE id = ?`, [inviteId]);
    await insertAudit(Number(row.team_id), session.id, "revoke_invite", String(inviteId));
  });
}

export async function removeMember(teamId: number, userId: number): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    await requireTeamRole(session, teamId, true);
    if (userId === session.id) throw new Error("Transfer team admin before leaving");
    const admins = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM team_members WHERE team_id = ? AND role = 'team_admin' AND user_id <> ?`,
      [teamId, userId],
    );
    const target = await queryOne<RowDataPacket & { role: string }>(
      `SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`,
      [teamId, userId],
    );
    if (target?.role === "team_admin" && Number(admins?.total ?? 0) === 0) {
      throw new Error("Assign another team admin before removing the last one");
    }
    await clearApiOwner(teamId, userId);
    await execute(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    await execute(
      `UPDATE users SET last_team_id = NULL WHERE id = ? AND last_team_id = ?`,
      [userId, teamId],
    );
    await insertAudit(teamId, session.id, "remove", String(userId));
  });
}

export async function setMemberRole(teamId: number, userId: number, role: "team_admin" | "member"): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireSuperadmin();
    await execute(`UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?`, [role, teamId, userId]);
    if (role === "member") await clearApiOwner(teamId, userId);
    await insertAudit(teamId, session.id, "role", `${userId}:${role}`);
  });
}

export async function assignMember(teamId: number, username: unknown, role: "team_admin" | "member"): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireSuperadmin();
    if (typeof username !== "string") throw new Error("Enter a username");
    const user = await findUserIdByUsername(username.trim().toLowerCase());
    if (!user || user.status !== "active") throw new Error("No active account uses that username");
    await execute(
      `INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      [teamId, user.id, role],
    );
    await insertAudit(teamId, session.id, "assign", `${username}:${role}`);
  });
}

export async function depositCredits(teamId: number, amount: number): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireSuperadmin();
    await fundTeam(teamId, session.id, amount);
    await insertAudit(teamId, session.id, "fund", String(amount));
  });
}

export async function addTeamBalance(teamId: number, amount: number): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireBalanceOwner(teamId);
    await addGlobal(teamId, session.id, amount);
    await insertAudit(teamId, session.id, "add_balance", String(amount));
  });
}

export async function removeTeamBalance(teamId: number, amount: number): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireBalanceOwner(teamId);
    await removeBalance(teamId, session.id, amount);
    await insertAudit(teamId, session.id, "remove_balance", String(amount));
  });
}

export async function saveMemberLimit(teamId: number, userId: number, limit: number): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireBalanceOwner(teamId);
    const own = await getApiKeyRow(userId);
    if (own) throw new Error("Member balance does not apply while they use their own API key");
    await setMemberLimit(teamId, session.id, userId, limit);
    await insertAudit(teamId, session.id, "member_limit", `${userId}:${limit}`);
  });
}

export async function readBalanceAlerts(teamId: number): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    await requireTeamRole(session, teamId, true);
    await markAlertsRead(teamId);
  });
}

export async function saveMemberTeamKey(teamId: number, userId: number, provider: KeyProvider, apiKey: string): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    await requireTeamRole(session, teamId, true);
    if (userId !== session.id) throw new Error("Save a team key only for your own admin account");
    if (provider !== "openrouter" && provider !== "higgsfield") throw new Error("Unknown provider");
    const member = await queryOne<RowDataPacket & { role: string }>(
      `SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`,
      [teamId, userId],
    );
    if (!member || member.role !== "team_admin") throw new ForbiddenError();
    await saveTeamKey(teamId, userId, provider, apiKey);
    await clearOwnerBalance(teamId, userId, session.id);
    await insertAudit(teamId, session.id, "team_key_set", String(userId));
  });
}

export async function clearMemberTeamKey(teamId: number, userId: number): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    await requireTeamRole(session, teamId, true);
    if (userId !== session.id) throw new Error("Remove only your own team key");
    await deleteTeamKey(teamId, userId);
    await clearOwnerBalance(teamId, userId, session.id);
    await insertAudit(teamId, session.id, "team_key_clear", String(userId));
  });
}

export async function selectTeamApi(teamId: number, userId: number): Promise<ActionResult<void>> {
  return run(async () => {
    const session = await requireActiveUser();
    const caller = await requireTeamRole(session, teamId, true);
    if (caller !== "team_admin") throw new ForbiddenError();
    const member = await queryOne<RowDataPacket & { role: string }>(
      `SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`,
      [teamId, userId],
    );
    if (!member || member.role !== "team_admin") throw new Error("Choose a team admin");
    await ensureOwnerWallet(teamId, userId);
    const mode = await ownerBillingMode(teamId, userId);
    await execute(`UPDATE teams SET api_user_id = ?, billing_mode = ? WHERE id = ?`, [userId, mode, teamId]);
    await insertAudit(teamId, session.id, "api_owner", String(userId));
  });
}

async function teamApiUserId(teamId: number): Promise<number | null> {
  const row = await queryOne<RowDataPacket & { api_user_id: number | null }>(
    `SELECT api_user_id FROM teams WHERE id = ?`,
    [teamId],
  );
  return row?.api_user_id == null ? null : Number(row.api_user_id);
}

async function clearApiOwner(teamId: number, userId: number): Promise<void> {
  await execute(`UPDATE teams SET api_user_id = NULL WHERE id = ? AND api_user_id = ?`, [teamId, userId]);
}

export async function listAllTeams(): Promise<ActionResult<{ id: number; name: string; status: string; billingMode: string }[]>> {
  return run(async () => {
    await requireSuperadmin();
    const { queryRows } = await import("@/db/client");
    const rows = await queryRows<RowDataPacket & { id: number; name: string; status: string; billing_mode: string }>(
      `SELECT id, name, status, billing_mode FROM teams ORDER BY name`,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      status: row.status,
      billingMode: row.billing_mode,
    }));
  });
}
