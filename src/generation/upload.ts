import { put } from "@vercel/blob/client";

export async function uploadMedia(file: File): Promise<{ url: string }> {
  const res = await fetch("/api/blob", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname: file.name, clientPayload: null, multipart: false },
    }),
  });
  if (res.status === 503) return uploadLocal(file);
  if (!res.ok) throw new Error("Failed to retrieve the client token");
  const { clientToken, pathname } = (await res.json()) as {
    clientToken?: unknown;
    pathname?: unknown;
  };
  if (typeof clientToken !== "string" || typeof pathname !== "string") {
    throw new Error("Failed to retrieve the client token");
  }
  const blob = await put(pathname, file, { access: "public", token: clientToken });
  return { url: blob.url };
}

async function uploadLocal(file: File): Promise<{ url: string }> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body });
  if (!res.ok) throw new Error("Local upload failed");
  const payload = (await res.json()) as { url?: unknown };
  if (typeof payload.url !== "string") throw new Error("Local upload failed");
  return { url: payload.url };
}
