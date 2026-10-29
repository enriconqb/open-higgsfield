import type { RowDataPacket } from "mysql2/promise";

import { requireApiIdentity } from "@/auth/api-auth";
import { queryRows } from "@/db/client";
import { withBasePath } from "@/base-path";

import { apiError, jsonOk, originOf } from "../_lib/http";

export const dynamic = "force-dynamic";

/** What this token has done, taken from the token itself.
 *
 * There is no user parameter anywhere: the bearer token identifies the owner, so
 * a client can only ever read its own rows. This is the reverse direction of
 * /generate — the app that started a job can come back and account for it. */
export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireApiIdentity(request, "read");
    const userId = identity.userId;
    const days = clampDays(new URL(request.url).searchParams.get("days"));

    const [summary, byModel, jobs, byToken] = await Promise.all([
      queryRows<RowDataPacket>(
        `SELECT COUNT(*) AS generations,
                COALESCE(SUM(status = 'success'), 0) AS success,
                COALESCE(SUM(status = 'failed'), 0) AS failed,
                COALESCE(SUM(status = 'pending'), 0) AS pending,
                COALESCE(SUM(CASE WHEN status = 'success' THEN credits ELSE 0 END), 0) AS credits,
                COALESCE(SUM(CASE WHEN status = 'success' THEN cost_usd ELSE 0 END), 0) AS cost_usd
         FROM usage_events
         WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [userId, days],
      ),
      queryRows<RowDataPacket>(
        `SELECT model_id, kind,
                COUNT(*) AS generations,
                COALESCE(SUM(CASE WHEN status = 'success' THEN credits ELSE 0 END), 0) AS credits
         FROM usage_events
         WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY model_id, kind
         ORDER BY credits DESC, generations DESC
         LIMIT 50`,
        [userId, days],
      ),
      queryRows<RowDataPacket>(
        `SELECT e.request_id, e.model_id, e.kind, e.status, e.credits, e.cost_usd, e.spec,
                e.token_id, e.created_at, j.result IS NOT NULL AS has_result
         FROM usage_events e
         LEFT JOIN api_jobs j ON j.request_id = e.request_id AND j.user_id = e.user_id
         WHERE e.user_id = ? AND e.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         ORDER BY e.created_at DESC
         LIMIT 100`,
        [userId, days],
      ),
      queryRows<RowDataPacket>(
        `SELECT e.token_id, t.label,
                COUNT(*) AS generations,
                COALESCE(SUM(CASE WHEN e.status = 'success' THEN e.credits ELSE 0 END), 0) AS credits
         FROM usage_events e
         LEFT JOIN api_tokens t ON t.id = e.token_id
         WHERE e.user_id = ? AND e.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY e.token_id, t.label
         ORDER BY credits DESC`,
        [userId, days],
      ),
    ]);

    const head = summary[0] ?? {};
    const base = `${originOf(request)}${withBasePath("/api/v1")}`;
    return jsonOk({
      userId,
      username: identity.username,
      token: {
        id: identity.tokenId,
        label: identity.tokenLabel,
        scopes: identity.scopes,
        expiresAt: identity.expiresAt ? identity.expiresAt.toISOString() : null,
      },
      window: { days },
      totals: {
        credits: Number(head.credits ?? 0),
        costUsd: Number(head.cost_usd ?? 0),
        generations: Number(head.generations ?? 0),
        success: Number(head.success ?? 0),
        failed: Number(head.failed ?? 0),
        pending: Number(head.pending ?? 0),
      },
      byModel: byModel.map((row) => ({
        model: String(row.model_id),
        kind: row.kind === "video" ? "video" : "image",
        generations: Number(row.generations ?? 0),
        credits: Number(row.credits ?? 0),
      })),
      byToken: byToken.map((row) => ({
        tokenId: row.token_id === null ? null : Number(row.token_id),
        label: row.label === null ? "(browser session)" : String(row.label),
        generations: Number(row.generations ?? 0),
        credits: Number(row.credits ?? 0),
      })),
      jobs: jobs.map((row) => ({
        requestId: String(row.request_id),
        model: String(row.model_id),
        kind: row.kind === "video" ? "video" : "image",
        status: String(row.status),
        credits: Number(row.credits ?? 0),
        costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
        spec: String(row.spec ?? ""),
        tokenId: row.token_id === null ? null : Number(row.token_id),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        jobUrl: row.has_result ? `${base}/jobs/${encodeURIComponent(String(row.request_id))}` : null,
      })),
    });
  } catch (caught) {
    return apiError(caught);
  }
}

function clampDays(raw: string | null): number {
  const value = Number(raw ?? "30");
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(1, Math.trunc(value)));
}
