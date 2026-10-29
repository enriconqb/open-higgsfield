import { mkdir, writeFile } from "fs/promises";
import { NextResponse } from "next/server";

import { AuthRequiredError, requireActiveUser } from "@/auth/guard";
import {
  sniffImageMime,
  uploadFilePath,
  uploadMaxBytes,
  uploadRoot,
  uploadTypePath,
} from "@/generation/local-upload";

/* The studio's local shelf: a reference the visitor sends is written to
   UPLOAD_DIR and handed back as /api/uploads/<id>, which GET below serves.
   Mirrors the allow-list in src/app/api/blob/route.ts and ROLE_ACCEPT. */
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/wav",
  "audio/x-wav",
]);

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/* Uploads are session material, so nothing about this route may be cached. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireActiveUser();
  } catch (caught) {
    if (caught instanceof AuthRequiredError) {
      return jsonError(401, "Login required");
    }
    throw caught;
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(400, "Missing file");
    if (!ALLOWED.has(file.type)) return jsonError(415, "Unsupported file type");

    const limit = uploadMaxBytes();
    if (file.size > limit) {
      return jsonError(413, `File is larger than ${Math.floor(limit / (1024 * 1024))} MB`);
    }
    if (file.size === 0) return jsonError(400, "The file is empty");

    const bytes = Buffer.from(await file.arrayBuffer());
    /* A declared content type is what the browser guessed from the name, so an
       image is confirmed against its own bytes before it reaches the disk. */
    if (IMAGE_TYPES.has(file.type) && !sniffImageMime(bytes)) {
      return jsonError(415, "File is not a png, jpeg, webp, or gif");
    }

    const id = crypto.randomUUID();
    await mkdir(uploadRoot(), { recursive: true });
    await writeFile(uploadFilePath(id), bytes);
    /* The sidecar keeps the original type for video and audio, whose bytes are
       not sniffed; inlineLocalMedia reads it when a reference is sent on. */
    await writeFile(uploadTypePath(id), file.type);
    return NextResponse.json({ url: `/api/uploads/${id}` });
  } catch (caught) {
    console.error("[uploads] failed", caught instanceof Error ? caught.message : caught);
    return jsonError(500, "Upload failed");
  }
}

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}
