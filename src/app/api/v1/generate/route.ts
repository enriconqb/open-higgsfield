import { requireApiContext } from "@/auth/api-auth";

import { apiError, jsonOk, readJsonObject } from "../_lib/http";
import { submitGeneration } from "../_lib/submit-generation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request, "generate");
    const body = await readJsonObject(request);
    const headerKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (headerKey && body.idempotencyKey == null) body.idempotencyKey = headerKey;
    const result = await submitGeneration(request, context, body);
    return jsonOk(result.payload, result.status);
  } catch (caught) {
    return apiError(caught);
  }
}
