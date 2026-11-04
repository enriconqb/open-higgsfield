import { readSession } from "@/auth/session";
import { getApiKeyRow } from "@/auth/users";
import type { GenerationPlane } from "@/generation/catalog/types";
import { estimatePlaneUsd } from "@/usage/record";
import { workspaceFor } from "./access";
import { holdCredits, noteOwnKeyUsage, settleHold } from "./credits";
import { membership } from "./store";

/** Blocks a team-key generation when global or member balance cannot cover the estimate. */
export async function reserveTeamSpend(userId: number, plane: GenerationPlane): Promise<void> {
  const session = await readSession();
  if (!session || session.id !== userId) return;
  const own = await getApiKeyRow(userId);
  if (own) return;
  const workspace = await workspaceFor(session);
  if (!workspace.teamId || !workspace.billingMode) return;
  const usd = roughUsd(plane);
  if (usd <= 0) return;
  const requestId = `reserve:${userId}:${plane.model}:${Date.now()}`;
  await holdCredits({
    teamId: workspace.teamId,
    userId,
    requestId,
    usd,
    mode: workspace.billingMode,
  });
  const bag = pendingHolds();
  bag.set(userId, { teamId: workspace.teamId, requestId, usd });
}

const holds = new Map<number, { teamId: number; requestId: string; usd: number }>();

function pendingHolds(): Map<number, { teamId: number; requestId: string; usd: number }> {
  return holds;
}

export async function bindHoldToRequest(
  userId: number,
  requestId: string,
): Promise<{ teamId: number } | null> {
  const pending = holds.get(userId);
  if (!pending) return null;
  holds.delete(userId);
  const { execute } = await import("@/db/client");
  await execute(
    `UPDATE team_credit_ledger SET request_id = ? WHERE team_id = ? AND request_id = ? AND kind = 'hold'`,
    [requestId, pending.teamId, pending.requestId],
  );
  return { teamId: pending.teamId };
}

export async function finishTeamSpend(input: {
  userId: number;
  requestId: string;
  usd: number;
  ok: boolean;
  teamId?: number | null;
}): Promise<void> {
  let teamId = input.teamId ?? null;
  if (!teamId) {
    const session = await readSession();
    if (session && session.id === input.userId) {
      const workspace = await workspaceFor(session);
      teamId = workspace.teamId;
    }
  }
  if (!teamId) return;
  const row = await membership(teamId, input.userId);
  if (!row) return;
  const own = await getApiKeyRow(input.userId);
  if (own) {
    if (input.ok) await noteOwnKeyUsage(teamId, input.userId, input.requestId, input.usd);
    return;
  }
  await settleHold({
    teamId,
    userId: input.userId,
    requestId: input.requestId,
    usd: input.usd,
    ok: input.ok,
  });
}

function roughUsd(plane: GenerationPlane): number {
  const batch = typeof plane.settings.batch === "number" ? plane.settings.batch : 1;
  return estimatePlaneUsd(null, plane) ?? Math.max(0.01, 0.01 * (batch > 0 ? batch : 1));
}
