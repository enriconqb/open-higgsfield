import type { RowDataPacket } from "mysql2/promise";

import { requireApiIdentity } from "@/auth/api-auth";
import { queryOne } from "@/db/client";
import { getApiKeyRow } from "@/auth/users";
import { withBasePath } from "@/base-path";

import { apiError, jsonOk, originOf } from "../_lib/http";

export const dynamic = "force-dynamic";

/** Who the token belongs to, what it may do, and which key it spends. */
export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireApiIdentity(request, "read");
    const [keyRow, usage] = await Promise.all([
      getApiKeyRow(identity.userId),
      queryOne<RowDataPacket & { credits: number; generations: number }>(
        `SELECT COALESCE(SUM(CASE WHEN status = 'success' THEN credits ELSE 0 END), 0) AS credits,
                COUNT(*) AS generations
         FROM usage_events
         WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [identity.userId],
      ),
    ]);

    return jsonOk({
      userId: identity.userId,
      username: identity.username,
      role: identity.role,
      keyKind: keyRow?.provider ?? null,
      hasPlatformKey: keyRow !== null,
      scopes: identity.scopes,
      token: {
        id: identity.tokenId,
        label: identity.tokenLabel,
        expiresAt: identity.expiresAt ? identity.expiresAt.toISOString() : null,
      },
      apiBase: `${originOf(request)}${withBasePath("/api/v1")}`,
      usage: {
        last30Days: {
          credits: Number(usage?.credits ?? 0),
          generations: Number(usage?.generations ?? 0),
        },
      },
    });
  } catch (caught) {
    return apiError(caught);
  }
}
