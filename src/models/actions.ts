"use server";

import type { RowDataPacket } from "mysql2/promise";

import { requireSuperadmin } from "@/auth/guard";
import { modelsFor } from "@/generation/catalog";
import type { Surface } from "@/generation/catalog";
import { execute, queryRows } from "@/db/client";
import { run, type ActionResult } from "@/lib/action-result";

import { isModelMark, type ModelMark } from "./marks";

export type ManagedModel = {
  id: string;
  label: string;
  surface: Surface;
  status: ModelMark | null;
};

type MarkRow = RowDataPacket & { model_id: string; status: string };

export async function readModelMarks(): Promise<Partial<Record<string, ModelMark>>> {
  const rows = await queryRows<MarkRow>("SELECT model_id, status FROM model_marks");
  const marks: Partial<Record<string, ModelMark>> = {};
  for (const row of rows) {
    if (isModelMark(row.status)) marks[row.model_id] = row.status;
  }
  return marks;
}

function studioModels() {
  const seen = new Set<string>();
  const list = [];
  for (const model of [...modelsFor("higgsfield"), ...modelsFor("openrouter")]) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    list.push(model);
  }
  return list;
}

export async function listModelMarks(): Promise<ActionResult<Partial<Record<string, ModelMark>>>> {
  return run(async () => {
    try {
      return await readModelMarks();
    } catch (caught) {
      console.error("[model-marks] read failed", caught);
      return {};
    }
  });
}

export async function adminListModels(): Promise<ActionResult<ManagedModel[]>> {
  return run(async () => {
    await requireSuperadmin();
    const marks = await readModelMarks();
    return studioModels().map((model) => ({
      id: model.id,
      label: model.label,
      surface: model.surface,
      status: marks[model.id] ?? null,
    }));
  });
}

export async function adminSetModelMark(input: {
  modelId: string;
  status: ModelMark | null;
}): Promise<ActionResult<ManagedModel[]>> {
  return run(async () => {
    await requireSuperadmin();
    const modelId = input.modelId.trim().slice(0, 128);
    if (!modelId || !studioModels().some((model) => model.id === modelId)) {
      throw new Error("Unknown model");
    }
    if (input.status === null) {
      await execute("DELETE FROM model_marks WHERE model_id = ?", [modelId]);
    } else if (!isModelMark(input.status)) {
      throw new Error("Unknown status");
    } else {
      await execute(
        `INSERT INTO model_marks (model_id, status) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)`,
        [modelId, input.status],
      );
    }
    const marks = await readModelMarks();
    return studioModels().map((model) => ({
      id: model.id,
      label: model.label,
      surface: model.surface,
      status: marks[model.id] ?? null,
    }));
  });
}
