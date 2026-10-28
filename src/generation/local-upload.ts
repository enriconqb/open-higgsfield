import { readFile } from "fs/promises";
import path from "path";

import type { GenerationPlane, MediaRole } from "./catalog/types";

const UPLOAD_ID = /\/api\/uploads\/([0-9a-f-]{36})/i;
const VALID_IMAGE_DATA = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

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

/** UUID from `/api/uploads/<id>` anywhere in the string, including an absolute
    origin such as `http://192.168.1.100/video-gen/api/uploads/<id>`. */
export function uploadIdFrom(url: string): string | null {
  if (!url || url.startsWith("data:")) return null;
  return UPLOAD_ID.exec(url)?.[1] ?? null;
}

function sniffImageMime(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  const head = bytes.length >= 6 ? bytes.toString("ascii", 0, 6) : "";
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function imageDataUrl(bytes: Buffer): string {
  const mime = sniffImageMime(bytes);
  if (!mime) throw new Error("Reference image URL was not accepted: file is not a png, jpeg, webp, or gif");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function normalizeItemUrl(url: string, role: MediaRole): Promise<string> {
  if (url.startsWith("https://")) return url;
  if (VALID_IMAGE_DATA.test(url)) return url;
  if (url.startsWith("data:")) {
    if (/^data:(video|audio)\//.test(url)) return url;
    const comma = url.indexOf(",");
    const payload = (comma === -1 ? "" : url.slice(comma + 1)).replace(/\s/g, "");
    return imageDataUrl(Buffer.from(payload, "base64"));
  }
  const id = uploadIdFrom(url);
  if (!id) return url;
  try {
    const bytes = await readFile(uploadFilePath(id));
    if (sniffImageMime(bytes)) return imageDataUrl(bytes);
    if (role === "video" || role === "audio") {
      const type = (await readFile(uploadTypePath(id), "utf8")).trim();
      if (type.startsWith("video/") || type.startsWith("audio/")) {
        return `data:${type};base64,${bytes.toString("base64")}`;
      }
    }
    return imageDataUrl(bytes);
  } catch (caught) {
    if (caught instanceof Error && caught.message.startsWith("Reference image")) throw caught;
    throw new Error("Reference image is missing on the server");
  }
}

/** Local files are not reachable by OpenRouter, so the server reads them and
    sends a data URL. Public https URLs and already-valid image data URLs stay. */
export async function inlineLocalMedia(plane: GenerationPlane): Promise<GenerationPlane> {
  const media: GenerationPlane["media"] = {};
  for (const [role, items] of Object.entries(plane.media) as Array<[MediaRole, GenerationPlane["media"][MediaRole]]>) {
    if (!items) continue;
    media[role] = await Promise.all(
      items.map(async (item) => ({ ...item, url: await normalizeItemUrl(item.url, role) })),
    );
  }
  return { ...plane, media };
}
