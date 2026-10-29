"use server";

import type { RunRecord } from "@/openhiggsfield/history";

import { listGenerationResults, replaceGenerationResults } from "./results";

export async function loadGenerationResults(): Promise<RunRecord[]> {
  return listGenerationResults();
}

export async function saveGenerationResults(records: RunRecord[]): Promise<RunRecord[]> {
  return replaceGenerationResults(records);
}
