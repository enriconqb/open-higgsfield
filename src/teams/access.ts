import { ForbiddenError } from "@/auth/errors";
import { readSession, writeSession } from "@/auth/session";
import type { SessionUser } from "@/auth/types";
import { hasStudioAdminAccess } from "@/auth/types";

import { membership } from "./store";
import type { TeamRole } from "./types";

export type Workspace = {
  teamId: number | null;
  role: TeamRole | null;
  billingMode: "global" | "member" | null;
  teamName: string | null;
};

/** Active team is trusted only after a fresh membership read. A stale cookie falls back to personal. */
export async function workspaceFor(session: SessionUser): Promise<Workspace> {
  const teamId = session.activeTeamId ?? null;
  if (!teamId) return { teamId: null, role: null, billingMode: null, teamName: null };
  const row = await membership(teamId, session.id);
  if (!row || row.status !== "active") {
    if (session.activeTeamId) {
      await writeSession({ ...session, activeTeamId: null });
    }
    return { teamId: null, role: null, billingMode: null, teamName: null };
  }
  return { teamId, role: row.role, billingMode: row.billingMode, teamName: row.name };
}

export async function requireTeamRole(session: SessionUser, teamId: number, admin: boolean): Promise<TeamRole> {
  const row = await membership(teamId, session.id);
  if (!row || row.status !== "active") throw new ForbiddenError();
  if (admin && row.role !== "team_admin" && !hasStudioAdminAccess(session.role)) throw new ForbiddenError();
  return row.role;
}

export function canPurgeTrash(role: TeamRole | null, platformRole: SessionUser["role"]): boolean {
  if (!role) return true;
  if (role === "team_admin") return true;
  return hasStudioAdminAccess(platformRole);
}

export async function currentWorkspace(): Promise<{ session: SessionUser; workspace: Workspace } | null> {
  const session = await readSession();
  if (!session) return null;
  return { session, workspace: await workspaceFor(session) };
}
