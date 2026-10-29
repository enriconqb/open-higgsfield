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
import {
  capabilitiesFor,
  quoteFor,
  statusesFor,
  submitPlane,
  type GenerationContext,
  type GenerationCredentials,
} from "./engine";
import type { OpenRouterQuote } from "./estimate";
import { PlatformError, openRouterBaseUrl } from "./platform";
import type { QueuedGeneration, StatusResult } from "./platform";

export async function savePlatformCredentials(data: unknown) {
  await saveEncryptedPlatformKey(data);
}

export async function clearPlatformCredentials() {
  await clearEncryptedPlatformKey();
}

export async function hasPlatformCredentials() {
  return hasEncryptedPlatformKey();
}

export async function openRouterCapabilities(modelId: string): Promise<OpenRouterCaps | null> {
  return capabilitiesFor(await sessionContext(), modelId);
}

export async function openRouterQuote(modelId: string): Promise<OpenRouterQuote | null> {
  return quoteFor(await sessionContext(), modelId);
}

export async function platformKeyKind(): Promise<KeyProvider | null> {
  return encryptedPlatformKeyKind();
}

export type GenerationSubmit = QueuedGeneration | { error: string };

export async function submitGeneration(plane: GenerationPlane): Promise<GenerationSubmit> {
  try {
    return await submitPlane(await sessionContext(), plane);
  } catch (caught) {
    return { error: submitError(caught) };
  }
}

/** Every request in flight, answered in one round trip. Next dispatches server
    actions one at a time per client, so a poll per run would queue ahead of the
    next submit — the fan-out belongs on this side of the call, where it is
    genuinely parallel. */
export async function getGenerationStatuses(data: unknown): Promise<StatusResult[]> {
  const requestIds = parseRequestIds(data);
  return statusesFor(await sessionContext(), requestIds);
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

function submitError(caught: unknown): string {
  if (caught instanceof AuthRequiredError || (caught instanceof Error && caught.message.includes("Login required"))) {
    return "Sign in to generate.";
  }
  if (
    caught instanceof MissingCredentialsError ||
    (caught instanceof Error && caught.message.includes("Missing platform key"))
  ) {
    return "Add your platform key to generate.";
  }
  if (caught instanceof PlatformError) return clip(caught.message);
  if (caught instanceof Error && caught.message.startsWith("Reference image")) return clip(caught.message);
  if (caught instanceof Error && caught.message.startsWith("Invalid ")) return clip(caught.message);
  if (caught instanceof Error && caught.message.startsWith("Unknown model")) return clip(caught.message);
  if (caught instanceof Error && caught.message.startsWith("No ")) return clip(caught.message);
  return "Generation failed. Try again.";
}

function clip(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean;
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
