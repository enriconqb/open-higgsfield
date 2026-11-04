import type { RowDataPacket } from "mysql2/promise";

import { getPool } from "@/db/client";

import type { BillingMode, CreditSnapshot } from "./types";

function dollars(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

type AccountRow = RowDataPacket & {
  funded_usd: number;
  remaining_usd: number;
  held_usd: number;
  cap_usd: number;
  billing_mode: BillingMode;
};

async function activeOwnerId(teamId: number): Promise<number | null> {
  const connection = await getPool().getConnection();
  try {
    const [rows] = await connection.query<(RowDataPacket & { api_user_id: number | null })[]>(
      `SELECT api_user_id FROM teams WHERE id = ?`,
      [teamId],
    );
    const id = rows[0]?.api_user_id;
    return id == null ? null : Number(id);
  } finally {
    connection.release();
  }
}

export async function ensureOwnerWallet(teamId: number, userId: number): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    await connection.query(
      `INSERT IGNORE INTO team_owner_balances (team_id, user_id) VALUES (?, ?)`,
      [teamId, userId],
    );
  } finally {
    connection.release();
  }
}

export async function ownerBillingMode(teamId: number, userId: number): Promise<BillingMode> {
  const connection = await getPool().getConnection();
  try {
    const [rows] = await connection.query<(RowDataPacket & { billing_mode: BillingMode })[]>(
      `SELECT billing_mode FROM team_owner_balances WHERE team_id = ? AND user_id = ?`,
      [teamId, userId],
    );
    return rows[0]?.billing_mode === "member" ? "member" : "global";
  } finally {
    connection.release();
  }
}

export async function setOwnerBillingMode(teamId: number, userId: number, mode: BillingMode): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    await connection.query(
      `INSERT INTO team_owner_balances (team_id, user_id, billing_mode) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE billing_mode = VALUES(billing_mode)`,
      [teamId, userId, mode],
    );
  } finally {
    connection.release();
  }
}

/** Empties one admin wallet when that admin replaces or removes their team key. */
export async function clearOwnerBalance(teamId: number, userId: number, actorId: number): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT IGNORE INTO team_owner_balances (team_id, user_id) VALUES (?, ?)`,
      [teamId, userId],
    );
    const [rows] = await connection.query<AccountRow[]>(
      `SELECT remaining_usd FROM team_owner_balances WHERE team_id = ? AND user_id = ? FOR UPDATE`,
      [teamId, userId],
    );
    const before = Number(rows[0]?.remaining_usd ?? 0);
    await connection.query(
      `UPDATE team_owner_balances SET remaining_usd = 0, held_usd = 0 WHERE team_id = ? AND user_id = ?`,
      [teamId, userId],
    );
    await connection.query(
      `INSERT INTO team_credit_ledger (team_id, user_id, actor_id, kind, amount_usd, before_usd, after_usd, note)
       VALUES (?, ?, ?, 'key_reset', ?, ?, 0, 'team key changed')`,
      [teamId, userId, actorId, before, before],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function snapshotFor(
  teamId: number,
  userId: number,
  usesTeamBalance: boolean,
): Promise<CreditSnapshot> {
  const connection = await getPool().getConnection();
  try {
    const [accounts] = await connection.query<AccountRow[]>(
      `SELECT b.funded_usd, b.remaining_usd, b.held_usd, 0 AS cap_usd, b.billing_mode
       FROM teams t
       LEFT JOIN team_owner_balances b ON b.team_id = t.id AND b.user_id = t.api_user_id
       WHERE t.id = ?`,
      [teamId],
    );
    const account = accounts[0];
    const [allowances] = await connection.query<(RowDataPacket & { limit_usd: number; spent_usd: number; held_usd: number })[]>(
      `SELECT limit_usd, spent_usd, held_usd FROM team_member_allowances WHERE team_id = ? AND user_id = ?`,
      [teamId, userId],
    );
    const mine = allowances[0];
    const funded = Number(account?.funded_usd ?? 0);
    const remaining = Number(account?.remaining_usd ?? 0);
    return {
      mode: account?.billing_mode ?? "global",
      funded,
      remaining,
      held: Number(account?.held_usd ?? 0),
      globalCap: Number(account?.cap_usd ?? 0),
      mine: mine
        ? { limit: Number(mine.limit_usd), spent: Number(mine.spent_usd), held: Number(mine.held_usd) }
        : null,
      usesTeamBalance,
      low: funded > 0 && remaining * 5 <= funded,
    };
  } finally {
    connection.release();
  }
}

async function openAlert(teamId: number, kind: "exhausted" | "member_limit" | "low", userId: number | null): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    const [existing] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM team_credit_alerts
       WHERE team_id = ? AND kind = ? AND read_at IS NULL AND ((? IS NULL AND user_id IS NULL) OR user_id = ?)
       LIMIT 1`,
      [teamId, kind, userId, userId],
    );
    if (existing.length > 0) return;
    await connection.query(
      `INSERT INTO team_credit_alerts (team_id, user_id, kind) VALUES (?, ?, ?)`,
      [teamId, userId, kind],
    );
  } finally {
    connection.release();
  }
}

/** Locks the wallet and refuses when the team or member limit cannot cover the estimate. */
export async function holdCredits(input: {
  teamId: number;
  userId: number;
  requestId: string;
  usd: number;
  mode: BillingMode;
}): Promise<void> {
  const usd = dollars(input.usd);
  if (usd === 0) return;
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [held] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM team_credit_ledger WHERE team_id = ? AND request_id = ? AND kind = 'hold' LIMIT 1`,
      [input.teamId, input.requestId],
    );
    if (held.length > 0) {
      await connection.commit();
      return;
    }
    const ownerId = await activeOwnerId(input.teamId);
    if (!ownerId) throw new Error("A team admin has to choose which admin API key this team uses.");
    const [accounts] = await connection.query<AccountRow[]>(
      `SELECT funded_usd, remaining_usd, held_usd, 0 AS cap_usd, billing_mode
       FROM team_owner_balances WHERE team_id = ? AND user_id = ? FOR UPDATE`,
      [input.teamId, ownerId],
    );
    const account = accounts[0];
    if (!account) throw new Error("This team has no dollar balance yet");
    const available = Number(account.remaining_usd) - Number(account.held_usd);
    if (available < usd) {
      await openAlert(input.teamId, "exhausted", null);
      throw new Error("Team balance is used up. A team admin has to add or reset it.");
    }
    if (input.mode === "member") {
      const [rows] = await connection.query<(RowDataPacket & { limit_usd: number; spent_usd: number; held_usd: number })[]>(
        `SELECT limit_usd, spent_usd, held_usd FROM team_member_allowances
         WHERE team_id = ? AND user_id = ? FOR UPDATE`,
        [input.teamId, input.userId],
      );
      const allowance = rows[0];
      const limit = Number(allowance?.limit_usd ?? 0);
      const spent = Number(allowance?.spent_usd ?? 0) + Number(allowance?.held_usd ?? 0);
      if (!allowance || spent + usd > limit) {
        await openAlert(input.teamId, "member_limit", input.userId);
        throw new Error("Your member balance has reached its limit.");
      }
      await connection.query(
        `UPDATE team_member_allowances SET held_usd = held_usd + ? WHERE team_id = ? AND user_id = ?`,
        [usd, input.teamId, input.userId],
      );
    }
    const before = Number(account.remaining_usd);
    await connection.query(
      `UPDATE team_owner_balances SET held_usd = held_usd + ? WHERE team_id = ? AND user_id = ?`,
      [usd, input.teamId, ownerId],
    );
    await connection.query(
      `INSERT INTO team_credit_ledger (team_id, user_id, actor_id, kind, amount_usd, before_usd, after_usd, request_id, note)
       VALUES (?, ?, ?, 'hold', ?, ?, ?, ?, ?)`,
      [input.teamId, input.userId, input.userId, usd, before, before, input.requestId, `owner:${ownerId}`],
    );
    if (Number(account.funded_usd) > 0 && (before - usd) * 5 <= Number(account.funded_usd)) {
      await openAlert(input.teamId, "low", null);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function settleHold(input: {
  teamId: number;
  userId: number;
  requestId: string;
  usd: number;
  ok: boolean;
}): Promise<void> {
  const usd = dollars(input.usd);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [holds] = await connection.query<(RowDataPacket & { amount_usd: number; note: string })[]>(
      `SELECT amount_usd, note FROM team_credit_ledger WHERE team_id = ? AND request_id = ? AND kind = 'hold' ORDER BY id DESC LIMIT 1`,
      [input.teamId, input.requestId],
    );
    const held = Number(holds[0]?.amount_usd ?? usd);
    const ownerFromNote = Number(String(holds[0]?.note ?? "").replace("owner:", ""));
    const ownerId = Number.isFinite(ownerFromNote) && ownerFromNote > 0 ? ownerFromNote : await activeOwnerId(input.teamId);
    const [done] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM team_credit_ledger WHERE team_id = ? AND request_id = ? AND kind IN ('spend', 'release') LIMIT 1`,
      [input.teamId, input.requestId],
    );
    if (done.length > 0 || held === 0) {
      await connection.commit();
      return;
    }
    const [accounts] = await connection.query<AccountRow[]>(
      `SELECT remaining_usd, funded_usd FROM team_owner_balances WHERE team_id = ? AND user_id = ? FOR UPDATE`,
      [input.teamId, ownerId],
    );
    const before = Number(accounts[0]?.remaining_usd ?? 0);
    if (input.ok) {
      const charge = usd > 0 ? usd : held;
      const after = Math.max(0, before - charge);
      await connection.query(
        `UPDATE team_owner_balances
         SET held_usd = IF(held_usd >= ?, held_usd - ?, 0),
             remaining_usd = ?
         WHERE team_id = ? AND user_id = ?`,
        [held, held, after, input.teamId, ownerId],
      );
      await connection.query(
        `UPDATE team_member_allowances
         SET held_usd = IF(held_usd >= ?, held_usd - ?, 0),
             spent_usd = spent_usd + ?
         WHERE team_id = ? AND user_id = ?`,
        [held, held, charge, input.teamId, input.userId],
      );
      await connection.query(
        `INSERT INTO team_credit_ledger (team_id, user_id, actor_id, kind, amount_usd, before_usd, after_usd, request_id)
         VALUES (?, ?, ?, 'spend', ?, ?, ?, ?)`,
        [input.teamId, input.userId, input.userId, charge, before, after, input.requestId],
      );
      if (after === 0) await openAlert(input.teamId, "exhausted", null);
    } else {
      await connection.query(
        `UPDATE team_owner_balances SET held_usd = IF(held_usd >= ?, held_usd - ?, 0) WHERE team_id = ? AND user_id = ?`,
        [held, held, input.teamId, ownerId],
      );
      await connection.query(
        `UPDATE team_member_allowances SET held_usd = IF(held_usd >= ?, held_usd - ?, 0) WHERE team_id = ? AND user_id = ?`,
        [held, held, input.teamId, input.userId],
      );
      await connection.query(
        `INSERT INTO team_credit_ledger (team_id, user_id, actor_id, kind, amount_usd, before_usd, after_usd, request_id)
         VALUES (?, ?, ?, 'release', ?, ?, ?, ?)`,
        [input.teamId, input.userId, input.userId, held, before, before, input.requestId],
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

export async function fundTeam(teamId: number, actorId: number, add: number): Promise<void> {
  const usd = dollars(add);
  if (usd === 0) throw new Error("Enter a dollar amount");
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`INSERT IGNORE INTO team_credit_accounts (team_id) VALUES (?)`, [teamId]);
    const [accounts] = await connection.query<AccountRow[]>(
      `SELECT funded_usd, remaining_usd FROM team_credit_accounts WHERE team_id = ? FOR UPDATE`,
      [teamId],
    );
    const beforeFunded = Number(accounts[0]?.funded_usd ?? 0);
    const beforeRemaining = Number(accounts[0]?.remaining_usd ?? 0);
    await connection.query(
      `UPDATE team_credit_accounts
       SET funded_usd = funded_usd + ?, remaining_usd = remaining_usd + ?, cap_usd = cap_usd + ?
       WHERE team_id = ?`,
      [usd, usd, usd, teamId],
    );
    await connection.query(
      `INSERT INTO team_credit_ledger (team_id, actor_id, kind, amount_usd, before_usd, after_usd, note)
       VALUES (?, ?, 'fund', ?, ?, ?, 'superadmin deposit')`,
      [teamId, actorId, usd, beforeRemaining, beforeRemaining + usd],
    );
    await connection.commit();
    void beforeFunded;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function addGlobal(teamId: number, actorId: number, add: number): Promise<void> {
  const usd = dollars(add);
  if (usd === 0) throw new Error("Enter a dollar amount");
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const ownerId = await activeOwnerId(teamId);
    if (!ownerId) throw new Error("Choose a team API before changing balance");
    await connection.query(
      `INSERT IGNORE INTO team_owner_balances (team_id, user_id) VALUES (?, ?)`,
      [teamId, ownerId],
    );
    const [accounts] = await connection.query<AccountRow[]>(
      `SELECT remaining_usd FROM team_owner_balances WHERE team_id = ? AND user_id = ? FOR UPDATE`,
      [teamId, ownerId],
    );
    const before = Number(accounts[0]?.remaining_usd ?? 0);
    const after = Math.round((before + usd) * 100) / 100;
    await connection.query(
      `UPDATE team_owner_balances SET remaining_usd = ?, funded_usd = funded_usd + ? WHERE team_id = ? AND user_id = ?`,
      [after, usd, teamId, ownerId],
    );
    await connection.query(
      `INSERT INTO team_credit_ledger (team_id, actor_id, kind, amount_usd, before_usd, after_usd, note)
       VALUES (?, ?, 'add', ?, ?, ?, 'add balance')`,
      [teamId, actorId, usd, before, after],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function removeBalance(teamId: number, actorId: number, amount: number): Promise<void> {
  const usd = dollars(amount);
  if (usd === 0) throw new Error("Enter a dollar amount");
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const ownerId = await activeOwnerId(teamId);
    if (!ownerId) throw new Error("Choose a team API before changing balance");
    const [accounts] = await connection.query<AccountRow[]>(
      `SELECT remaining_usd, held_usd FROM team_owner_balances WHERE team_id = ? AND user_id = ? FOR UPDATE`,
      [teamId, ownerId],
    );
    const before = Number(accounts[0]?.remaining_usd ?? 0);
    const held = Number(accounts[0]?.held_usd ?? 0);
    const free = Math.round((before - held) * 100) / 100;
    if (usd > free) throw new Error("That amount is more than the balance that is not already held");
    const after = Math.round((before - usd) * 100) / 100;
    await connection.query(`UPDATE team_owner_balances SET remaining_usd = ? WHERE team_id = ? AND user_id = ?`, [after, teamId, ownerId]);
    await connection.query(
      `INSERT INTO team_credit_ledger (team_id, actor_id, kind, amount_usd, before_usd, after_usd, note)
       VALUES (?, ?, 'remove', ?, ?, ?, 'remove balance')`,
      [teamId, actorId, usd, before, after],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Records a generation on the team ledger without changing the balance. */
export async function noteOwnKeyUsage(teamId: number, userId: number, requestId: string, usd: number): Promise<void> {
  const amount = dollars(usd);
  if (amount === 0) return;
  const connection = await getPool().getConnection();
  try {
    const [existing] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM team_credit_ledger WHERE team_id = ? AND request_id = ? AND kind = 'usage' LIMIT 1`,
      [teamId, requestId],
    );
    if (existing.length > 0) return;
    const ownerId = await activeOwnerId(teamId);
    const [accounts] = await connection.query<AccountRow[]>(
      `SELECT remaining_usd FROM team_owner_balances WHERE team_id = ? AND user_id = ?`,
      [teamId, ownerId],
    );
    const remaining = Number(accounts[0]?.remaining_usd ?? 0);
    await connection.query(
      `INSERT INTO team_credit_ledger (team_id, user_id, actor_id, kind, amount_usd, before_usd, after_usd, request_id, note)
       VALUES (?, ?, ?, 'usage', ?, ?, ?, ?, 'own API key')`,
      [teamId, userId, userId, amount, remaining, remaining, requestId],
    );
  } finally {
    connection.release();
  }
}

export async function resetGlobal(teamId: number, actorId: number): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [accounts] = await connection.query<AccountRow[]>(
      `SELECT funded_usd, remaining_usd, cap_usd FROM team_credit_accounts WHERE team_id = ? FOR UPDATE`,
      [teamId],
    );
    const account = accounts[0];
    if (!account) throw new Error("Fund this team before resetting balance");
    const before = Number(account.remaining_usd);
    const target = Math.min(Number(account.cap_usd), Number(account.funded_usd));
    await connection.query(
      `UPDATE team_credit_accounts SET remaining_usd = ?, held_usd = 0 WHERE team_id = ?`,
      [target, teamId],
    );
    await connection.query(
      `INSERT INTO team_credit_ledger (team_id, actor_id, kind, amount_usd, before_usd, after_usd, note)
       VALUES (?, ?, 'reset', ?, ?, ?, 'team admin reset')`,
      [teamId, actorId, target - before, before, target],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function setMemberLimit(teamId: number, actorId: number, userId: number, limit: number): Promise<void> {
  const usd = dollars(limit);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const ownerId = await activeOwnerId(teamId);
    const [accounts] = await connection.query<AccountRow[]>(
      `SELECT remaining_usd FROM team_owner_balances WHERE team_id = ? AND user_id = ? FOR UPDATE`,
      [teamId, ownerId],
    );
    const remaining = Number(accounts[0]?.remaining_usd ?? 0);
    if (usd > remaining) throw new Error("Member limit cannot exceed the team balance still available");
    const [current] = await connection.query<(RowDataPacket & { limit_usd: number })[]>(
      `SELECT limit_usd FROM team_member_allowances WHERE team_id = ? AND user_id = ? FOR UPDATE`,
      [teamId, userId],
    );
    const before = Number(current[0]?.limit_usd ?? 0);
    await connection.query(
      `INSERT INTO team_member_allowances (team_id, user_id, limit_usd)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE limit_usd = VALUES(limit_usd)`,
      [teamId, userId, usd],
    );
    await connection.query(
      `INSERT INTO team_credit_ledger (team_id, user_id, actor_id, kind, amount_usd, before_usd, after_usd, note)
       VALUES (?, ?, ?, 'limit', ?, ?, ?, 'member limit')`,
      [teamId, userId, actorId, usd - before, before, usd],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function markAlertsRead(teamId: number): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    await connection.query(
      `UPDATE team_credit_alerts SET read_at = CURRENT_TIMESTAMP
       WHERE team_id = ? AND read_at IS NULL AND kind IN ('exhausted', 'member_limit')`,
      [teamId],
    );
  } finally {
    connection.release();
  }
}
