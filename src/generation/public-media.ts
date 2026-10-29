import { createHmac, timingSafeEqual } from "node:crypto";

import { withBasePath } from "@/base-path";
import { SITE_URL } from "@/site";

import { mediaHttpsEnabled } from "./media-https";

/* A generation provider downloads reference media itself, so a file on this
   server only works as a reference when it is reachable over public HTTPS — a
   `data:` URL is refused with "Only HTTPS URLs are allowed". The flag
   `NEXT_PUBLIC_MEDIA_HTTPS=true` is this deployment saying it has such an
   origin (the one NEXT_PUBLIC_SITE_URL names); without it, local media keeps
   the inline data-URL behaviour for images and refuses video outright.

   The address carries a signature because the studio's own /api/uploads route
   demands a session cookie, and the provider has none. The token is derived
   from SESSION_SECRET, so rotating that secret retires every old link. */

/** Public https origin a provider can reach, or null when there is none. */
export function publicMediaOrigin(): string | null {
  const explicit = process.env.PUBLIC_MEDIA_ORIGIN?.trim();
  if (explicit) {
    const trimmed = explicit.replace(/\/+$/, "");
    return trimmed.startsWith("https://") ? trimmed : null;
  }
  if (!mediaHttpsEnabled() || !SITE_URL.startsWith("https://")) return null;
  return SITE_URL;
}

/** Signature that lets a provider read one uploaded file without a session. */
export function mediaToken(id: string): string | null {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  return createHmac("sha256", secret).update(`upload:${id}`).digest("base64url");
}

export function mediaTokenMatches(id: string, token: string): boolean {
  const expected = mediaToken(id);
  if (!expected || !token) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Absolute address of a stored upload for a provider, or null when none exists. */
export function publicMediaUrl(id: string): string | null {
  const origin = publicMediaOrigin();
  const token = mediaToken(id);
  if (!origin || !token) return null;
  return `${origin}${withBasePath(`/api/uploads/${id}`)}?t=${token}`;
}
