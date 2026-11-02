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

export async function discardGalleryTrashItems(clientIds: string[]): Promise<ActionResult<void>> {
  return run(() => discardGalleryTrash(clientIds));
}

export async function saveGenerationResults(records: RunRecord[]): Promise<ActionResult<RunRecord[]>> {
  return run(() => replaceGenerationResults(records));
}
