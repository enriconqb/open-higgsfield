import { readFile } from "fs/promises";
import path from "path";

import type { GenerationPlane, MediaRole } from "./catalog/types";

const UPLOAD_ID = /\/api\/uploads\/([0-9a-f-]{36})$/i;

/** Directory for local uploads. `UPLOAD_DIR` overrides when the process cwd is
    not the app root (for example `/var/www/html/video-gen`). */
export function uploadRoot(): string {
  const override = process.env.UPLOAD_DIR?.trim();
  return override ? path.resolve(override) : path.join(process.cwd(), "uploads");
}

export function uploadFilePath(id: string): string {
  return path.join(uploadRoot(), id);
}

export function uploadTypePath(id: string): string {
  return path.join(uploadRoot(), `${id}.type`);
}

/** UUID from `/api/uploads/<id>`, including a base path and an absolute origin
    such as `http://192.168.1.100/video-gen/api/uploads/<id>`. */
export function uploadIdFrom(url: string): string | null {
  if (!url || url.startsWith("data:")) return null;
  try {
    const pathname = new URL(url, "http://local").pathname;
    return UPLOAD_ID.exec(pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Local files are not reachable by OpenRouter, so the server reads them and
    sends a data URL. Public https URLs and existing data URLs are left as-is. */
export async function inlineLocalMedia(plane: GenerationPlane): Promise<GenerationPlane> {
  const media: GenerationPlane["media"] = {};
  for (const [role, items] of Object.entries(plane.media) as Array<[MediaRole, GenerationPlane["media"][MediaRole]]>) {
    if (!items) continue;
    media[role] = await Promise.all(
      items.map(async (item) => {
        const id = uploadIdFrom(item.url);
        if (!id) return item;
        try {
          const [bytes, type] = await Promise.all([
            readFile(uploadFilePath(id)),
            readFile(uploadTypePath(id), "utf8"),
          ]);
          return { ...item, url: `data:${type.trim()};base64,${bytes.toString("base64")}` };
        } catch {
          throw new Error("Reference image is missing on the server");
        }
      }),
    );
  }
  return { ...plane, media };
}
