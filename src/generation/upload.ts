import { apiUrl } from "@/base-path";
import type { GenerationPlane, MediaRole } from "./catalog/types";

export async function uploadMedia(file: File): Promise<{ url: string }> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch(apiUrl("/api/uploads"), { method: "POST", body });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const detail = payload && typeof payload.error === "string" ? payload.error : "";
    throw new Error(detail || "Local upload failed");
  }
  const payload = (await res.json()) as { url?: unknown };
  if (typeof payload.url !== "string") throw new Error("Local upload failed");
  return { url: apiUrl(payload.url) };
}

/** Data URLs from finished image runs are too large for a server action. Store
    them on disk first so the action only receives a short `/api/uploads` URL. */
export async function rehostDataMedia(plane: GenerationPlane): Promise<GenerationPlane> {
  const media: GenerationPlane["media"] = {};
  for (const [role, items] of Object.entries(plane.media) as Array<
    [MediaRole, GenerationPlane["media"][MediaRole]]
  >) {
    if (!items) continue;
    media[role] = await Promise.all(
      items.map(async (item) => {
        if (!item.url.startsWith("data:")) return item;
        const uploaded = await uploadMedia(dataUrlToFile(item.url, item.id));
        return { ...item, url: uploaded.url };
      }),
    );
  }
  return { ...plane, media };
}

function dataUrlToFile(url: string, name: string): File {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (!match) throw new Error("Invalid reference image");
  const type = match[1] || "application/octet-stream";
  const payload = match[3] ?? "";
  const bytes = match[2] ? decodeBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type });
}

function decodeBase64(payload: string): Uint8Array {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
