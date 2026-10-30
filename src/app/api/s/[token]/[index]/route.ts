import { readFile } from "fs/promises";
import { NextResponse } from "next/server";

import { sniffImageMime, uploadFilePath, uploadTypePath } from "@/generation/local-upload";
import { readShareClip } from "@/share/actions";

export const dynamic = "force-dynamic";

const PRIVATE = {
  "Content-Disposition": "inline",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Accept-Ranges": "bytes",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; index: string }> },
): Promise<NextResponse> {
  const { token, index: indexText } = await context.params;
  const index = Number(indexText);
  if (!/^\d+$/.test(indexText)) return new NextResponse(null, { status: 404 });
  const clip = await readShareClip(token, index);
  if (!clip) return new NextResponse(null, { status: 404 });

  if (clip.source === "upload") {
    try {
      const bytes = await readFile(uploadFilePath(clip.id));
      const sidecar = await readFile(uploadTypePath(clip.id), "utf8").catch(() => "");
      const type = sniffImageMime(bytes) ?? (sidecar.trim() || fallbackType(clip.kind));
      return rangedBytes(bytes, type, request.headers.get("range"));
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(clip.url, {
      headers: range ? { Range: range } : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  if ((!upstream.ok && upstream.status !== 206) || !upstream.body || upstream.status >= 300) {
    return new NextResponse(null, { status: 502 });
  }
  const type = upstream.headers.get("Content-Type")?.split(";")[0]?.trim() || fallbackType(clip.kind);
  if (!/^(image|video)\//.test(type) && type !== "application/octet-stream") {
    return new NextResponse(null, { status: 502 });
  }
  const headers: Record<string, string> = { ...PRIVATE, "Content-Type": type };
  const length = upstream.headers.get("Content-Length");
  const contentRange = upstream.headers.get("Content-Range");
  if (length) headers["Content-Length"] = length;
  if (contentRange) headers["Content-Range"] = contentRange;
  return new NextResponse(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}

function rangedBytes(bytes: Buffer, type: string, header: string | null): NextResponse {
  const size = bytes.byteLength;
  const range = parseRange(header, size);
  if (range === "invalid") {
    return new NextResponse(null, {
      status: 416,
      headers: { ...PRIVATE, "Content-Range": `bytes */${size}` },
    });
  }
  if (!range) {
    return new NextResponse(new Uint8Array(bytes), {
      headers: { ...PRIVATE, "Content-Type": type, "Content-Length": String(size) },
    });
  }
  const slice = bytes.subarray(range.start, range.end + 1);
  return new NextResponse(new Uint8Array(slice), {
    status: 206,
    headers: {
      ...PRIVATE,
      "Content-Type": type,
      "Content-Length": String(slice.byteLength),
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    },
  });
}

function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return "invalid";
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "" && endText === "") return "invalid";
  if (startText === "") {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText === "" ? size - 1 : Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || start > end) {
    return "invalid";
  }
  return { start, end: Math.min(end, size - 1) };
}

function fallbackType(kind: "image" | "video"): string {
  return kind === "image" ? "image/jpeg" : "video/mp4";
}
