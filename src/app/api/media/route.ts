import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { PLATFORM_KEY_COOKIE, decodeCredentials } from "@/generation/credentials";
import { openRouterBaseUrl } from "@/generation/platform";

const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Streams an OpenRouter video when the poll response only has unsigned URLs. */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const job = url.searchParams.get("job") ?? "";
  const index = Number(url.searchParams.get("index") ?? "0");
  if (!JOB_ID.test(job) || !Number.isInteger(index) || index < 0 || index > 9) {
    return NextResponse.json({ detail: "Invalid media request" }, { status: 400 });
  }

  const jar = await cookies();
  const apiKey = decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value)?.apiKey || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ detail: "Missing platform key" }, { status: 401 });

  const upstream = await fetch(
    `${openRouterBaseUrl()}/videos/${encodeURIComponent(job)}/content?index=${index}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ detail: "OpenRouter media unavailable" }, { status: upstream.status || 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "video/mp4",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
