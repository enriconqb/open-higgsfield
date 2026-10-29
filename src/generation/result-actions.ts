"use server";

import type { RunRecord } from "@/openhiggsfield/history";
import { run, type ActionResult } from "@/lib/action-result";

import { listGenerationResults, replaceGenerationResults } from "./results";

export async function loadGenerationResults(): Promise<ActionResult<RunRecord[]>> {
  return run(listGenerationResults);
}

export async function saveGenerationResults(records: RunRecord[]): Promise<ActionResult<RunRecord[]>> {
  return run(() => replaceGenerationResults(records));
}
