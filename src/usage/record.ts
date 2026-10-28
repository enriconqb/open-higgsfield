import type { RowDataPacket } from "mysql2/promise";

import { requireActiveUser } from "@/auth/guard";
import { execute, queryOne } from "@/db/client";
import type { GenerationPlane } from "@/generation/catalog/types";
import { estimateUsd, type OpenRouterQuote } from "@/generation/estimate";

import { creditsFromUsd } from "./credits";

export type UsageKind = "image" | "video";
export type UsageStatus = "pending" | "success" | "failed";

export function usageSpec(settings: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof settings.resolution === "string" && settings.resolution) parts.push(settings.resolution);
  if (typeof settings.duration === "number" && settings.duration > 0) parts.push(`${settings.duration}s`);
  if (typeof settings.aspectRatio === "string" && settings.aspectRatio) parts.push(settings.aspectRatio);
  return parts.join(" · ").slice(0, 128);
}

export function estimatePlaneUsd(quote: OpenRouterQuote | null, plane: GenerationPlane): number | null {
  if (!quote) return null;
  const media = plane.media;
  const images = (media.start?.length ?? 0) + (media.end?.length ?? 0) + (media.reference?.length ?? 0);
  const batch = typeof plane.settings.batch === "number" ? plane.settings.batch : 1;
  return estimateUsd(quote, {
    resolution: typeof plane.settings.resolution === "string" ? plane.settings.resolution : undefined,
    aspectRatio: typeof plane.settings.aspectRatio === "string" ? plane.settings.aspectRatio : undefined,
    duration: typeof plane.settings.duration === "number" ? plane.settings.duration : undefined,
    audio: plane.settings.generateAudio === true || plane.settings.sound === true,
    images,
    videos: media.video?.length ?? 0,
    audios: media.audio?.length ?? 0,
    batch: batch > 0 ? batch : 1,
  });
}

export async function recordUsage(input: {
  requestId: string;
  modelId: string;
  kind: UsageKind;
  spec: string;
  costUsd: number | null;
  status: UsageStatus;
}): Promise<void> {
  const user = await requireActiveUser();
  const credits = creditsFromUsd(input.costUsd);
  await execute(
    `INSERT INTO usage_events (user_id, request_id, model_id, kind, spec, cost_usd, credits, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = IF(VALUES(status) = 'pending', status, VALUES(status)),
       cost_usd = COALESCE(VALUES(cost_usd), cost_usd),
       credits = IF(VALUES(cost_usd) IS NULL, credits, VALUES(credits))`,
    [
      user.id,
      input.requestId.slice(0, 128),
      input.modelId.slice(0, 128),
      input.kind,
      input.spec.slice(0, 128),
      input.costUsd,
      credits,
      input.status,
    ],
  );
}

export function usageStatusFromPlatform(status: string): UsageStatus | null {
  if (status === "completed") return "success";
  if (status === "failed" || status === "canceled") return "failed";
  return null;
}

export async function settleUsage(input: {
  requestId: string;
  status: UsageStatus;
  costUsd?: number;
}): Promise<void> {
  const user = await requireActiveUser();
  const existing = await queryOne<RowDataPacket & { cost_usd: string | null }>(
    `SELECT cost_usd FROM usage_events WHERE request_id = ? AND user_id = ?`,
    [input.requestId, user.id],
  );
  if (!existing) return;
  const costUsd =
    input.costUsd != null && input.costUsd > 0
      ? input.costUsd
      : existing.cost_usd != null
        ? Number(existing.cost_usd)
        : null;
  await execute(
    `UPDATE usage_events
     SET status = ?, cost_usd = ?, credits = ?
     WHERE request_id = ? AND user_id = ?`,
    [input.status, costUsd, creditsFromUsd(costUsd), input.requestId, user.id],
  );
}
