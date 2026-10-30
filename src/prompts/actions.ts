"use server";

import type { RowDataPacket } from "mysql2/promise";

import { requireActiveUser, requireSuperadmin } from "@/auth/guard";
import { execute, queryOne, queryRows } from "@/db/client";
import { run, type ActionResult } from "@/lib/action-result";

export type PromptTemplate = {
  id: number;
  title: string;
  body: string;
  scope: "global" | "mine";
  editable: boolean;
};

type TemplateRow = RowDataPacket & {
  id: number;
  user_id: number | null;
  title: string;
  body: string;
};

const TITLE_MAX = 120;
const BODY_MAX = 8000;

function mapRow(row: TemplateRow, userId: number, isSuperadmin: boolean): PromptTemplate {
  const global = row.user_id == null;
  return {
    id: Number(row.id),
    title: String(row.title),
    body: String(row.body),
    scope: global ? "global" : "mine",
    editable: global ? isSuperadmin : Number(row.user_id) === userId,
  };
}

async function loadVisible(userId: number, isSuperadmin: boolean): Promise<PromptTemplate[]> {
  const rows = await queryRows<TemplateRow>(
    `SELECT id, user_id, title, body
     FROM prompt_templates
     WHERE user_id IS NULL OR user_id = ?
     ORDER BY user_id IS NULL DESC, updated_at DESC, id DESC`,
    [userId],
  );
  return rows.map((row) => mapRow(row, userId, isSuperadmin));
}

function cleanText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const text = value.trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} is too long`);
  return text;
}

export async function listPromptTemplates(): Promise<ActionResult<PromptTemplate[]>> {
  return run(async () => {
    const user = await requireActiveUser();
    return loadVisible(user.id, user.role === "superadmin");
  });
}

export async function savePromptTemplate(input: {
  id?: number;
  title: string;
  body: string;
  scope: "global" | "mine";
}): Promise<ActionResult<PromptTemplate[]>> {
  return run(async () => {
    const user = input.scope === "global" ? await requireSuperadmin() : await requireActiveUser();
    const title = cleanText(input.title, TITLE_MAX, "Title");
    const body = cleanText(input.body, BODY_MAX, "Prompt");
    const ownerId = input.scope === "global" ? null : user.id;

    if (input.id != null) {
      const existing = await queryOne<TemplateRow>(
        "SELECT id, user_id, title, body FROM prompt_templates WHERE id = ?",
        [input.id],
      );
      if (!existing) throw new Error("Template not found");
      const global = existing.user_id == null;
      if (global && user.role !== "superadmin") throw new Error("Forbidden");
      if (!global && Number(existing.user_id) !== user.id) throw new Error("Forbidden");
      if (global !== (input.scope === "global")) throw new Error("Cannot change template scope");
      await execute("UPDATE prompt_templates SET title = ?, body = ? WHERE id = ?", [title, body, input.id]);
    } else {
      await execute("INSERT INTO prompt_templates (user_id, title, body) VALUES (?, ?, ?)", [ownerId, title, body]);
    }
    return loadVisible(user.id, user.role === "superadmin");
  });
}

export async function deletePromptTemplate(input: { id: number }): Promise<ActionResult<PromptTemplate[]>> {
  return run(async () => {
    const user = await requireActiveUser();
    const existing = await queryOne<TemplateRow>(
      "SELECT id, user_id, title, body FROM prompt_templates WHERE id = ?",
      [input.id],
    );
    if (!existing) throw new Error("Template not found");
    const global = existing.user_id == null;
    if (global) await requireSuperadmin();
    else if (Number(existing.user_id) !== user.id) throw new Error("Forbidden");
    await execute("DELETE FROM prompt_templates WHERE id = ?", [input.id]);
    return loadVisible(user.id, user.role === "superadmin");
  });
}
