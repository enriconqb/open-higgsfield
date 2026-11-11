import { open, readFile } from "fs/promises";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { sniffImageMime, uploadFilePath, uploadTypePath } from "@/generation/local-upload";
import { readShareClip } from "@/share/actions";

export const dynamic = "force-dynamic";

const PRIVATE = {
  "Content-Disposition": "inline",
  "Cache-Control": "private, max-age=3600",
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
    return streamUpload(clip.id, clip.kind, request.headers.get("range"));
  }

  const range = request.headers.get("range");
  const pending = new AbortController();
  const timer = setTimeout(() => pending.abort(), 20_000);
  let upstream: Response;
  try {
    upstream = await fetch(clip.url, {
      headers: range ? { Range: range } : undefined,
      redirect: "manual",
      signal: pending.signal,
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  } finally {
    clearTimeout(timer);
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

async function streamUpload(id: string, kind: "image" | "video", header: string | null): Promise<NextResponse> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(uploadFilePath(id), "r");
    const { size } = await handle.stat();
    if (size <= 0) {
      await handle.close();
      return new NextResponse(null, {
        headers: { ...PRIVATE, "Content-Type": fallbackType(kind), "Content-Length": "0" },
      });
    }
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const sidecar = await readFile(uploadTypePath(id), "utf8").catch(() => "");
    const type = sniffImageMime(head.subarray(0, bytesRead)) ?? (sidecar.trim() || fallbackType(kind));
    const range = parseRange(header, size);
    if (range === "invalid") {
      await handle.close();
      return new NextResponse(null, {
        status: 416,
        headers: { ...PRIVATE, "Content-Range": `bytes */${size}` },
      });
    }
    const start = range?.start ?? 0;
    const end = range ? range.end : Math.max(0, size - 1);
    const node = handle.createReadStream({ start, end, autoClose: true });
    handle = null;
    const body = Readable.toWeb(node) as ReadableStream<Uint8Array>;
    return new NextResponse(body, {
      status: range ? 206 : 200,
      headers: {
        ...PRIVATE,
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      },
    });
  } catch {
    await handle?.close().catch(() => undefined);
    return new NextResponse(null, { status: 404 });
  }
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
