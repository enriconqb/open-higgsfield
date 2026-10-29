import { NextResponse } from "next/server";

import { ApiError } from "@/auth/api-auth";
import { MissingCredentialsError } from "@/generation/credentials";
import { PlatformError } from "@/generation/platform";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function jsonError(status: number, detail: string): NextResponse {
  return NextResponse.json({ detail }, { status, headers: NO_STORE });
}

/** Every /api/v1 failure leaves as `{ "detail": "..." }` so a client can show one
    line without guessing at the shape. */
export function apiError(caught: unknown): NextResponse {
  if (caught instanceof ApiError) return jsonError(caught.status, caught.message);
  if (caught instanceof PlatformError) return jsonError(platformStatus(caught), caught.message);
  if (caught instanceof MissingCredentialsError) {
    return jsonError(409, "No platform key saved for this account.");
  }
  if (caught instanceof Error) {
    if (/^(Unknown model|Invalid |No |Reference image)/.test(caught.message)) {
      return jsonError(400, caught.message);
    }
    console.error("[api] request failed", caught.message);
  }
  return jsonError(500, "Request failed");
}

function platformStatus(error: PlatformError): number {
  if (error.status === 402) return 402;
  if (error.status === 429) return 429;
  if (error.status >= 400 && error.status < 500) {
    return error.status === 401 || error.status === 403 ? 502 : 400;
  }
  return 502;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = (await request.text()).trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "Body must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export { originOf } from "@/generation/engine";
