"use server";

import { randomBytes } from "node:crypto";

import type { RowDataPacket } from "mysql2/promise";

import { requireActiveUser } from "@/auth/guard";
import { execute, queryOne } from "@/db/client";
import { run, type ActionResult } from "@/lib/action-result";

import { clipFromUrl, parseShareFacts, parseStoredClips, publicFact, type StoredClip } from "./clips";
import type { ClipKind, ShareFact, ShareKind } from "./types";

export type PublicShare = {
  token: string;
  kind: ShareKind;
  count: number;
  facts: ShareFact[];
};

type ShareRow = RowDataPacket & { token: string; kind: string; clips: unknown };

function readClips(value: unknown): StoredClip[] | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  return parseStoredClips(parsed);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function createShare(input: {
  kind: ShareKind;
  clips: { kind: ClipKind; url: string; model?: string; ratio?: string; size?: string }[];
}): Promise<ActionResult<{ token: string }>> {
  return run(async () => {
    const user = await requireActiveUser();
    if (input.kind !== "image" && input.kind !== "video" && input.kind !== "timeline") {
      throw new Error("Unknown share");
    }
    const limit = input.kind === "timeline" ? 20 : 1;
    if (!Array.isArray(input.clips) || input.clips.length === 0 || input.clips.length > limit) {
      throw new Error("Nothing to share");
    }
    const stored: Array<StoredClip & ShareFact> = [];
    for (const clip of input.clips) {
      if (input.kind === "image" && clip.kind !== "image") throw new Error("Share an image");
      if (input.kind !== "image" && clip.kind !== "video") throw new Error("Share a video");
      const next = clipFromUrl(clip.url, clip.kind);
      if (!next) throw new Error("This result cannot be shared yet");
      const fact = publicFact(clip);
      stored.push({ ...next, ...fact });
    }
    const token = randomBytes(32).toString("base64url");
    await execute("INSERT INTO shares (token, user_id, kind, clips) VALUES (?, ?, ?, ?)", [
      token,
      user.id,
      input.kind,
      JSON.stringify(stored),
    ]);
    return { token };
  });
}

export async function readPublicShare(token: string): Promise<PublicShare | null> {
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(token)) return null;
  const row = await queryOne<ShareRow>("SELECT token, kind, clips FROM shares WHERE token = ?", [token]);
  if (!row || (row.kind !== "image" && row.kind !== "video" && row.kind !== "timeline")) return null;
  const clips = readClips(row.clips);
  const facts = parseShareFacts(typeof row.clips === "string" ? safeJson(row.clips) : row.clips);
  if (!clips || !facts) return null;
  return { token: row.token, kind: row.kind, count: clips.length, facts };
}

export async function readShareClip(token: string, index: number): Promise<StoredClip | null> {
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(token) || !Number.isInteger(index) || index < 0) return null;
  const row = await queryOne<ShareRow>("SELECT token, kind, clips FROM shares WHERE token = ?", [token]);
  if (!row) return null;
  const clips = readClips(row.clips);
  return clips?.[index] ?? null;
}
