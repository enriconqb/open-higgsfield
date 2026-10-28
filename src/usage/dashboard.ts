"use server";

import type { RowDataPacket } from "mysql2/promise";

import { requireActiveUser } from "@/auth/guard";
import { queryRows } from "@/db/client";

export type UsageFilters = {
  from: string;
  to: string;
  modelId: string;
  kind: "" | "image" | "video";
  status: "" | "pending" | "success" | "failed";
  requestId: string;
  username: string;
};

export type UsageRow = {
  createdAt: string;
  username: string;
  modelId: string;
  kind: "image" | "video";
  spec: string;
  credits: number;
  costUsd: number | null;
  status: "pending" | "success" | "failed";
  requestId: string;
};

export type UsageDay = { day: string; credits: number };
export type UsageTopUser = { username: string; generations: number; credits: number };

export type UsageDashboard = {
  isSuperadmin: boolean;
  filters: UsageFilters;
  usernames: string[];
  models: string[];
  kpis: {
    credits: number;
    generations: number;
    success: number;
    failed: number;
    activeUsers: number;
  };
  days: UsageDay[];
  topUsers: UsageTopUser[];
  rows: UsageRow[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: isoDay(from), to: isoDay(to) };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function cleanFilters(data: unknown, isSuperadmin: boolean): UsageFilters {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const fallback = defaultRange();
  const from = typeof raw.from === "string" && DAY.test(raw.from) ? raw.from : fallback.from;
  const to = typeof raw.to === "string" && DAY.test(raw.to) ? raw.to : fallback.to;
  const kind = raw.kind === "image" || raw.kind === "video" ? raw.kind : "";
  const status =
    raw.status === "pending" || raw.status === "success" || raw.status === "failed" ? raw.status : "";
  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    modelId: typeof raw.modelId === "string" ? raw.modelId.slice(0, 128) : "",
    kind,
    status,
    requestId: typeof raw.requestId === "string" ? raw.requestId.trim().slice(0, 128) : "",
    username: isSuperadmin && typeof raw.username === "string" ? raw.username.slice(0, 64) : "",
  };
}

export async function loadUsageDashboard(data?: unknown): Promise<UsageDashboard> {
  const user = await requireActiveUser();
  const isSuperadmin = user.role === "superadmin";
  const filters = cleanFilters(data, isSuperadmin);
  const where = ["e.created_at >= ?", "e.created_at < DATE_ADD(?, INTERVAL 1 DAY)"];
  const params: Array<string | number> = [`${filters.from} 00:00:00`, filters.to];
  if (!isSuperadmin) {
    where.push("e.user_id = ?");
    params.push(user.id);
  } else if (filters.username) {
    where.push("u.username = ?");
    params.push(filters.username);
  }
  if (filters.modelId) {
    where.push("e.model_id = ?");
    params.push(filters.modelId);
  }
  if (filters.kind) {
    where.push("e.kind = ?");
    params.push(filters.kind);
  }
  if (filters.status) {
    where.push("e.status = ?");
    params.push(filters.status);
  }
  if (filters.requestId) {
    where.push("e.request_id LIKE ?");
    params.push(`%${filters.requestId.replace(/[\\%_]/g, "")}%`);
  }
  const clause = where.join(" AND ");

  const scopeWhere = isSuperadmin ? "1=1" : "e.user_id = ?";
  const scopeParams = isSuperadmin ? [] : [user.id];

  const [summary, days, rows, models, usernames, topUsers] = await Promise.all([
    queryRows<RowDataPacket>(
      `SELECT
         COALESCE(SUM(CASE WHEN e.status = 'success' THEN e.credits ELSE 0 END), 0) AS credits,
         COUNT(*) AS generations,
         COALESCE(SUM(e.status = 'success'), 0) AS success_count,
         COALESCE(SUM(e.status = 'failed'), 0) AS failed_count,
         COUNT(DISTINCT e.user_id) AS active_users
       FROM usage_events e
       INNER JOIN users u ON u.id = e.user_id
       WHERE ${clause}`,
      params,
    ),
    queryRows<RowDataPacket>(
      `SELECT DATE_FORMAT(e.created_at, '%Y-%m-%d') AS day,
              COALESCE(SUM(CASE WHEN e.status = 'success' THEN e.credits ELSE 0 END), 0) AS credits
       FROM usage_events e
       INNER JOIN users u ON u.id = e.user_id
       WHERE ${clause}
       GROUP BY DATE_FORMAT(e.created_at, '%Y-%m-%d')
       ORDER BY day`,
      params,
    ),
    queryRows<RowDataPacket>(
      `SELECT e.created_at, u.username, e.model_id, e.kind, e.spec, e.credits, e.cost_usd, e.status, e.request_id
       FROM usage_events e
       INNER JOIN users u ON u.id = e.user_id
       WHERE ${clause}
       ORDER BY e.created_at DESC
       LIMIT 500`,
      params,
    ),
    queryRows<RowDataPacket>(
      `SELECT DISTINCT e.model_id
       FROM usage_events e
       WHERE ${scopeWhere}
       ORDER BY e.model_id`,
      scopeParams,
    ),
    isSuperadmin
      ? queryRows<RowDataPacket>(
          `SELECT DISTINCT u.username
           FROM usage_events e
           INNER JOIN users u ON u.id = e.user_id
           ORDER BY u.username`,
        )
      : Promise.resolve([]),
    isSuperadmin
      ? queryRows<RowDataPacket>(
          `SELECT u.username, COUNT(*) AS generations,
                  COALESCE(SUM(CASE WHEN e.status = 'success' THEN e.credits ELSE 0 END), 0) AS credits
           FROM usage_events e
           INNER JOIN users u ON u.id = e.user_id
           WHERE ${clause}
           GROUP BY u.id, u.username
           ORDER BY credits DESC, generations DESC
           LIMIT 5`,
          params,
        )
      : Promise.resolve([]),
  ]);

  const head = summary[0] ?? {};
  return {
    isSuperadmin,
    filters,
    usernames: usernames.map((row) => String(row.username)),
    models: models.map((row) => String(row.model_id)),
    kpis: {
      credits: Number(head.credits ?? 0),
      generations: Number(head.generations ?? 0),
      success: Number(head.success_count ?? 0),
      failed: Number(head.failed_count ?? 0),
      activeUsers: Number(head.active_users ?? 0),
    },
    days: days.map((row) => ({ day: String(row.day), credits: Number(row.credits ?? 0) })),
    topUsers: topUsers.map((row) => ({
      username: String(row.username),
      generations: Number(row.generations ?? 0),
      credits: Number(row.credits ?? 0),
    })),
    rows: rows.map((row) => ({
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      username: String(row.username),
      modelId: String(row.model_id),
      kind: row.kind === "video" ? "video" : "image",
      spec: String(row.spec ?? ""),
      credits: Number(row.credits ?? 0),
      costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
      status: row.status === "success" || row.status === "failed" ? row.status : "pending",
      requestId: String(row.request_id),
    })),
  };
}
