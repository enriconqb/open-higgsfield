import { apiUrl } from "@/base-path";

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
