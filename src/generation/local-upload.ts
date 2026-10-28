import { readFile } from "fs/promises";
import path from "path";

import type { GenerationPlane, MediaRole } from "./catalog/types";

export const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

/** Canonical `/api/uploads/<id>`, or the same path under NEXT_PUBLIC_BASE_PATH. */
const LOCAL_URL = /^(?:\/[^/]+)?\/api\/uploads\/([0-9a-f-]{36})$/i;

export function uploadFilePath(id: string): string {
  return path.join(UPLOAD_ROOT, id);
}

export function uploadTypePath(id: string): string {
  return path.join(UPLOAD_ROOT, `${id}.type`);
}

/** Local files are not reachable by OpenRouter, so the server reads them and
    sends a data URL. Stored paths are `/api/uploads/<id>`, with the mount prefix when set. */
export async function inlineLocalMedia(plane: GenerationPlane): Promise<GenerationPlane> {
  const media: GenerationPlane["media"] = {};
  for (const [role, items] of Object.entries(plane.media) as Array<[MediaRole, GenerationPlane["media"][MediaRole]]>) {
    if (!items) continue;
    media[role] = await Promise.all(
      items.map(async (item) => {
        const match = LOCAL_URL.exec(item.url);
        if (!match) return item;
        const id = match[1]!;
        const [bytes, type] = await Promise.all([
          readFile(uploadFilePath(id)),
          readFile(uploadTypePath(id), "utf8"),
        ]);
        return { ...item, url: `data:${type.trim()};base64,${bytes.toString("base64")}` };
      }),
    );
  }
  return { ...plane, media };
}
