import { readFile } from "fs/promises";
import { NextResponse } from "next/server";

import { AuthRequiredError, requireActiveUser } from "@/auth/guard";
import { sniffImageMime, uploadFilePath, uploadTypePath } from "@/generation/local-upload";

/* Uploaded files carry a UUID name, so the shape is the traversal guard: an id
   with no dot or slash can only ever resolve inside UPLOAD_DIR. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

/** The bytes a visitor uploaded, for the studio to render as a reference. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireActiveUser();
  } catch (caught) {
    if (caught instanceof AuthRequiredError) {
      return new NextResponse(null, { status: 401 });
    }
    throw caught;
  }

  const { id } = await context.params;
  if (!ID.test(id)) return new NextResponse(null, { status: 404 });

  try {
    const bytes = await readFile(uploadFilePath(id));
    const sidecar = await readFile(uploadTypePath(id), "utf8").catch(() => "");
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": sniffImageMime(bytes) ?? (sidecar.trim() || "application/octet-stream"),
        "Content-Length": String(bytes.byteLength),
        /* The name is a UUID and the bytes never change, but the file is one
           account's material — private, and only this browser holds it. */
        "Cache-Control": "private, max-age=31536000",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
