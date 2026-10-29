import { NextResponse } from "next/server";

/** Unauthenticated liveness probe for machine clients.
 *
 * Its job is to separate "the address is wrong" from "the token is wrong":
 * OpenMontage's settings page calls this before it ever sends a token, so a
 * failure here means the base URL is off, not the credential. It exposes
 * nothing about the instance beyond its identity and API version. */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    { ok: true, app: "vicend", api: "v1", time: new Date().toISOString() },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
