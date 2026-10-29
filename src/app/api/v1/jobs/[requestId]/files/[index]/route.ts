import { readFile } from "fs/promises";
import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/auth/api-auth";
import { parseJobResult } from "@/generation/api-jobs";
import { uploadFilePath } from "@/generation/local-upload";

import { apiError, jsonError } from "../../../../_lib/http";
import { requireJob } from "../../../../_lib/jobs";

export const dynamic = "force-dynamic";

type Segment = { params: Promise<{ requestId: string; index: string }> };

/** Image bytes for a finished job. A token is required: the uploads directory is
    otherwise only reachable through the studio cookie. */
export async function GET(request: Request, segment: Segment): Promise<Response> {
  try {
    const identity = await requireApiIdentity(request, "read");
    const { requestId, index } = await segment.params;
    const job = await requireJob(identity.userId, requestId);
    const position = Number(index);
    if (!Number.isInteger(position) || position < 0) return jsonError(404, "Image not found");

    const image = (parseJobResult(job.result).images ?? []).find((item) => item.index === position);
    if (!image) return jsonError(404, "Image not found");

    if (image.id) {
      try {
        const bytes = await readFile(uploadFilePath(image.id));
        return new NextResponse(new Uint8Array(bytes), {
          status: 200,
          headers: {
            "Content-Type": image.mime || "application/octet-stream",
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": "private, max-age=3600",
          },
        });
      } catch {
        return jsonError(404, "Image file is gone from the server");
      }
    }
    if (image.url && image.url.startsWith("data:")) {
      const comma = image.url.indexOf(",");
      const bytes = Buffer.from(comma === -1 ? "" : image.url.slice(comma + 1), "base64");
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": image.mime || "application/octet-stream",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
    if (image.url && /^https:\/\//i.test(image.url)) {
      return NextResponse.redirect(image.url, 302);
    }
    return jsonError(404, "Image not found");
  } catch (caught) {
    return apiError(caught);
  }
}
