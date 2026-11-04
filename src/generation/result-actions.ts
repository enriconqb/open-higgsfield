"use server";

import type { RunRecord } from "@/openhiggsfield/history";
import { run, type ActionResult } from "@/lib/action-result";

import { discardGalleryTrash, listGalleryTrash, type GalleryTrashItem } from "./gallery-trash";
import { listGenerationResults, replaceGenerationResults } from "./results";

export async function loadGenerationResults(): Promise<ActionResult<RunRecord[]>> {
  return run(listGenerationResults);
}

export async function loadGalleryTrash(): Promise<ActionResult<GalleryTrashItem[]>> {
  return run(listGalleryTrash);
}

export async function trashMayPurge(): Promise<ActionResult<boolean>> {
  return run(async () => {
    const { requireActiveUser } = await import("@/auth/guard");
    const { canPurgeTrash, workspaceFor } = await import("@/teams/access");
    const user = await requireActiveUser();
    const workspace = await workspaceFor(user);
    return canPurgeTrash(workspace.role, user.role);
  });
}

export async function discardGalleryTrashItems(clientIds: string[]): Promise<ActionResult<void>> {
  return run(() => discardGalleryTrash(clientIds));
}

export async function saveGenerationResults(records: RunRecord[]): Promise<ActionResult<RunRecord[]>> {
  return run(() => replaceGenerationResults(records));
}
