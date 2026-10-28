import { put } from "@vercel/blob/client";

import { apiUrl } from "@/base-path";

export async function uploadMedia(file: File): Promise<{ url: string }> {
  try {
    const res = await fetch(apiUrl("/api/blob"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: { pathname: file.name, clientPayload: null, multipart: false },
      }),
    });
    if (res.status === 401) throw new Error("Login required");
    if (res.ok) {
      const { clientToken, pathname } = (await res.json()) as {
        clientToken?: unknown;
        pathname?: unknown;
      };
      if (typeof clientToken === "string" && typeof pathname === "string") {
        try {
          const blob = await put(pathname, file, { access: "public", token: clientToken });
          return { url: blob.url };
        } catch {
          return uploadLocal(file);
        }
      }
    }
  } catch (caught) {
    if (caught instanceof Error && caught.message === "Login required") throw caught;
  }
  return uploadLocal(file);
}

async function uploadLocal(file: File): Promise<{ url: string }> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch(apiUrl("/api/uploads"), { method: "POST", body });
  if (!res.ok) throw new Error("Local upload failed");
  const payload = (await res.json()) as { url?: unknown };
  if (typeof payload.url !== "string") throw new Error("Local upload failed");
  return { url: apiUrl(payload.url) };
}
