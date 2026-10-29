"use server";

import { headers } from "next/headers";
import { clearEncryptedPlatformKey, saveEncryptedPlatformKey } from "@/auth/actions";
import { AuthRequiredError } from "@/auth/errors";
import { requireActiveUser } from "@/auth/guard";
import {
  encryptedPlatformKeyKind,
  hasEncryptedPlatformKey,
  resolveUserCredentials,
} from "@/auth/resolve-credentials";

import type { OpenRouterCaps } from "./capabilities";
import type { GenerationPlane } from "./catalog/types";
import { MissingCredentialsError } from "./credentials";
import type { KeyProvider } from "./credentials";
import { ActionError, run, type ActionResult } from "@/lib/action-result";
import {
  capabilitiesFor,
  quoteFor,
  statusesFor,
  submitPlane,
  type GenerationContext,
  type GenerationCredentials,
} from "./engine";
import type { OpenRouterQuote } from "./estimate";
import { openRouterBaseUrl } from "./platform";
import type { QueuedGeneration, StatusResult } from "./platform";

export async function savePlatformCredentials(data: unknown): Promise<ActionResult<void>> {
  return run(async () => {
    const saved = await saveEncryptedPlatformKey(data);
    if (!saved.ok) throw new ActionError(saved.error);
  });
}

export async function clearPlatformCredentials(): Promise<ActionResult<void>> {
  return run(async () => {
    const cleared = await clearEncryptedPlatformKey();
    if (!cleared.ok) throw new ActionError(cleared.error);
  });
}

export async function hasPlatformCredentials(): Promise<ActionResult<boolean>> {
  return run(hasEncryptedPlatformKey);
}

export async function openRouterCapabilities(
  modelId: string,
): Promise<ActionResult<OpenRouterCaps | null>> {
  return run(async () => capabilitiesFor(await sessionContext(), modelId));
}

export async function openRouterQuote(modelId: string): Promise<ActionResult<OpenRouterQuote | null>> {
  return run(async () => quoteFor(await sessionContext(), modelId));
}

export async function platformKeyKind(): Promise<ActionResult<KeyProvider | null>> {
  return run(encryptedPlatformKeyKind);
}

export type GenerationSubmit = QueuedGeneration | { error: string };

export async function submitGeneration(
  plane: GenerationPlane,
): Promise<ActionResult<QueuedGeneration>> {
  return run(async () => submitPlane(await sessionContext(), plane));
}

/** Every request in flight, answered in one round trip. Next dispatches server
    actions one at a time per client, so a poll per run would queue ahead of the
    next submit — the fan-out belongs on this side of the call, where it is
    genuinely parallel. */
export async function getGenerationStatuses(data: unknown): Promise<ActionResult<StatusResult[]>> {
  return run(async () => statusesFor(await sessionContext(), parseRequestIds(data)));
}

/** The studio identity: session cookie for the user, stored key for the spend. */
async function sessionContext(): Promise<GenerationContext> {
  const session = await requireActiveUser();
  return {
    userId: session.id,
    credentials: await sessionCredentials(),
    origin: await sessionOrigin(),
  };
}

async function sessionCredentials(): Promise<GenerationCredentials> {
  try {
    const stored = await resolveUserCredentials();
    if (stored.provider === "higgsfield") {
      const baseUrl = process.env.HF_API_BASE_URL;
      if (!baseUrl) throw new Error("Missing HF_API_BASE_URL");
      return { apiKey: stored.apiKey, baseUrl, provider: "higgsfield" };
    }
    return { apiKey: stored.apiKey, baseUrl: openRouterBaseUrl(), provider: "openrouter" };
  } catch (caught) {
    if (caught instanceof MissingCredentialsError) throw caught;
    if (caught instanceof AuthRequiredError) throw caught;
    if (caught instanceof Error && caught.message.includes("Missing platform key")) {
      throw new MissingCredentialsError();
    }
    throw caught;
  }
}

async function sessionOrigin(): Promise<string> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  if (!host) return "";
  const proto = incoming.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function parseRequestIds(data: unknown): string[] {
  const payload = asObject(data, "Invalid status payload");
  const requestIds = payload.requestIds;
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    throw new Error("Invalid request ids");
  }
  return requestIds.map((requestId) => {
    if (typeof requestId !== "string" || !requestId) throw new Error("Invalid request id");
    return requestId;
  });
}

function asObject(data: unknown, message: string): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error(message);
  return data as Record<string, unknown>;
}
