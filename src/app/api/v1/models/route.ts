import { requireApiIdentity } from "@/auth/api-auth";
import { getApiKeyRow } from "@/auth/users";
import { modelsFor } from "@/generation/catalog";

import { apiError, jsonOk } from "../_lib/http";

export const dynamic = "force-dynamic";

/** The same catalog the studio shows, already filtered to the key this token
    spends: a higgsfield account and an OpenRouter account do not see the same
    models, and submitting the wrong id is a 400. */
export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireApiIdentity(request, "read");
    const keyRow = await getApiKeyRow(identity.userId);
    const platform = keyRow?.provider ?? "openrouter";
    const models = modelsFor(platform);
    return jsonOk({
      platform,
      hasPlatformKey: keyRow !== null,
      models: models.map((model) => ({
        id: model.id,
        surface: model.surface,
        label: model.label,
        media: Object.entries(model.roles).map(([role, max]) => ({ role, max })),
        settings: model.settings,
      })),
    });
  } catch (caught) {
    return apiError(caught);
  }
}
