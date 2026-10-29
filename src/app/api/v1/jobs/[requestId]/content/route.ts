import { NextResponse } from "next/server";

import { requireApiContext } from "@/auth/api-auth";
import { parseJobResult } from "@/generation/api-jobs";
import { toAuthorizationHeader } from "@/generation/credentials";
import { openRouterBaseUrl } from "@/generation/platform";

import { apiError, jsonError } from "../../../_lib/http";
import { refreshJob, requireJob } from "../../../_lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Segment = { params: Promise<{ requestId: string }> };

/** Video bytes for a finished job. OpenRouter usually hands out a signed URL, so
    this only streams when the poll response had unsigned urls only — the token
    authenticated twin of `/api/media`. */
export async function GET(request: Request, segment: Segment): Promise<Response> {
  try {
    const context = await requireApiContext(request, "read");
    const { requestId } = await segment.params;
    const job = await requireJob(context.identity.userId, requestId);

    const refreshed = await refreshJob(context, job);
    const url = parseJobResult(refreshed.result).video?.url;
    if (url && /^https:\/\//i.test(url)) return NextResponse.redirect(url, 302);

    if (context.credentials.provider !== "openrouter") {
      return jsonError(404, "No streamable media for this job");
    }
    const index = Number(new URL(request.url).searchParams.get("index") ?? "0");
    if (!Number.isInteger(index) || index < 0 || index > 9) {
      return jsonError(400, "Invalid index");
    }

    const upstream = await fetch(
      `${openRouterBaseUrl()}/videos/${encodeURIComponent(refreshed.request_id)}/content?index=${index}`,
      { headers: { Authorization: toAuthorizationHeader(context.credentials.apiKey, "openrouter") } },
    );
    if (!upstream.ok || !upstream.body) {
      return jsonError(upstream.status || 502, "Media unavailable");
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "video/mp4",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (caught) {
    return apiError(caught);
  }
}
