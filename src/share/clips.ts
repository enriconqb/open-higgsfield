import { isIP } from "node:net";

import type { ClipKind, ShareFact, ShareKind } from "./types";

export type { ClipKind, ShareFact, ShareKind };

export type StoredClip =
  | { kind: ClipKind; source: "upload"; id: string }
  | { kind: ClipKind; source: "remote"; url: string };

const UPLOAD_ID = /\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|[/?#])/i;

const FACT_MAX = 80;

export function publicFact(value: {
  model?: unknown;
  ratio?: unknown;
  size?: unknown;
}): ShareFact {
  return {
    model: shortFact(value.model),
    ratio: shortFact(value.ratio),
    size: shortFact(value.size),
  };
}

export function parseStoredClips(value: unknown): StoredClip[] | null {
  const rows = clipRows(value);
  if (!rows) return null;
  const clips: StoredClip[] = [];
  for (const row of rows) {
    if (row.source === "upload" && typeof row.id === "string" && UPLOAD_ID.test(`/uploads/${row.id}`)) {
      clips.push({ kind: row.kind, source: "upload", id: row.id });
      continue;
    }
    if (row.source === "remote" && typeof row.url === "string" && isPublicHttps(row.url)) {
      clips.push({ kind: row.kind, source: "remote", url: row.url });
      continue;
    }
    return null;
  }
  return clips;
}

export function parseShareFacts(value: unknown): ShareFact[] | null {
  const rows = clipRows(value);
  if (!rows) return null;
  return rows.map((row) => publicFact(row));
}

function clipRows(value: unknown): Array<{
  kind: ClipKind;
  source?: unknown;
  id?: unknown;
  url?: unknown;
  model?: unknown;
  ratio?: unknown;
  size?: unknown;
}> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const rows: Array<{
    kind: ClipKind;
    source?: unknown;
    id?: unknown;
    url?: unknown;
    model?: unknown;
    ratio?: unknown;
    size?: unknown;
  }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as {
      kind?: unknown;
      source?: unknown;
      id?: unknown;
      url?: unknown;
      model?: unknown;
      ratio?: unknown;
      size?: unknown;
    };
    if (row.kind !== "image" && row.kind !== "video") return null;
    const kind: ClipKind = row.kind;
    rows.push({
      kind,
      source: row.source,
      id: row.id,
      url: row.url,
      model: row.model,
      ratio: row.ratio,
      size: row.size,
    });
  }
  return rows;
}

function shortFact(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, FACT_MAX);
}

/** Turn a studio URL into a clip we can serve without the owner's session. */
export function clipFromUrl(url: string, kind: ClipKind): StoredClip | null {
  const trimmed = url.trim();
  const upload = trimmed.match(UPLOAD_ID);
  if (upload?.[1]) return { kind, source: "upload", id: upload[1] };
  if (isPublicHttps(trimmed)) return { kind, source: "remote", url: trimmed };
  return null;
}

function isPublicHttps(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  const ip = isIP(host);
  if (ip === 4 && isPrivateV4(host)) return false;
  if (ip === 6 && isPrivateV6(host)) return false;
  return true;
}

function isPrivateV4(host: string): boolean {
  const [a, b] = host.split(".").map((part) => Number(part));
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateV6(host: string): boolean {
  const value = host.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80");
}
