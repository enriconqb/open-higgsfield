"use server";

import { clearEncryptedPlatformKey, saveEncryptedPlatformKey } from "@/auth/actions";
import { AuthRequiredError } from "@/auth/errors";
import {
  encryptedPlatformKeyKind,
  hasEncryptedPlatformKey,
  resolveUserCredentials,
} from "@/auth/resolve-credentials";

import { overlayModel, snapSettings } from "./capabilities";
import { inlineLocalMedia } from "./local-upload";
import type { OpenRouterCaps } from "./capabilities";
import { getModel, parseSettings } from "./catalog";
import { openRouterSlug } from "./catalog/openrouter-slugs";
import type { ImagePriceLine, OpenRouterQuote } from "./estimate";
import { skuUsd } from "./estimate";
import type { GenerationPlane } from "./catalog/types";
import { MissingCredentialsError } from "./credentials";
import type { KeyProvider } from "./credentials";
import { createHiggsfieldClient, createPlatformClient, openRouterBaseUrl, PlatformError } from "./platform";
import type { QueuedGeneration, StatusResult } from "./platform";
import { toHiggsfield } from "./to-higgsfield";
import { toPlatform } from "./to-platform";
import { estimatePlaneUsd, recordUsage, settleUsage, usageSpec, usageStatusFromPlatform } from "@/usage/record";

export async function savePlatformCredentials(data: unknown) {
  await saveEncryptedPlatformKey(data);
}

export async function clearPlatformCredentials() {
  await clearEncryptedPlatformKey();
}

export async function hasPlatformCredentials() {
  return hasEncryptedPlatformKey();
}

const PRICE_TTL_MS = 5 * 60_000;
let videoSkuCache: { at: number; models: Map<string, { skus: Record<string, number>; sizes: string[] }> } | null = null;
const imagePriceCache = new Map<string, { at: number; lines: ImagePriceLine[] }>();

const capsCache = new Map<string, { at: number; caps: OpenRouterCaps }>();

export async function openRouterCapabilities(modelId: string): Promise<OpenRouterCaps | null> {
  const credentials = await readCredentials();
  if (credentials.provider !== "openrouter") return null;
  let slug: string;
  try {
    slug = openRouterSlug(modelId);
  } catch {
    return null;
  }
  const cached = capsCache.get(slug);
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.caps;
  const model = getModel(modelId);
  const caps =
    model.surface === "image" ? await imageCaps(credentials, slug) : await videoCaps(credentials, slug);
  capsCache.set(slug, { at: Date.now(), caps });
  return caps;
}

async function imageCaps(
  credentials: { apiKey: string; baseUrl: string },
  slug: string,
): Promise<OpenRouterCaps> {
  const [list, endpoints] = await Promise.all([
    openRouterJson(credentials, "/images/models"),
    openRouterJson(credentials, `/images/models/${slug}/endpoints`),
  ]);
  const resolution = new Set<string>();
  const aspectRatio = new Set<string>();
  const quality = new Set<string>();
  const collect = (params: unknown) => {
    if (!params || typeof params !== "object") return;
    const record = params as { resolution?: unknown; aspect_ratio?: unknown; quality?: unknown };
    for (const value of enumValues(record.resolution)) resolution.add(value);
    for (const value of enumValues(record.aspect_ratio)) aspectRatio.add(value);
    for (const value of enumValues(record.quality)) quality.add(value);
  };
  for (const item of asList(list && typeof list === "object" ? (list as { data?: unknown }).data : null)) {
    const row = asObject(item, "caps");
    if (row.id !== slug) continue;
    collect(row.supported_parameters);
  }
  for (const endpoint of asList(
    endpoints && typeof endpoints === "object" ? (endpoints as { endpoints?: unknown }).endpoints : null,
  )) {
    collect(asObject(endpoint, "caps").supported_parameters);
  }
  return {
    ...(resolution.size ? { resolution: sortResolutions([...resolution]) } : {}),
    ...(aspectRatio.size ? { aspectRatio: [...aspectRatio] } : {}),
    ...(quality.size ? { quality: [...quality] } : {}),
  };
}

const RESOLUTION_ORDER = ["512", "768", "1K", "1.5K", "2K", "4K"];

function sortResolutions(values: string[]): string[] {
  return values.sort((a, b) => {
    const ai = RESOLUTION_ORDER.indexOf(a);
    const bi = RESOLUTION_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

async function videoCaps(
  credentials: { apiKey: string; baseUrl: string },
  slug: string,
): Promise<OpenRouterCaps> {
  const payload = await openRouterJson(credentials, "/videos/models");
  for (const item of asList(payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null)) {
    const row = asObject(item, "caps");
    if (row.id !== slug) continue;
    const resolution = stringList(row.supported_resolutions);
    const aspectRatio = stringList(row.supported_aspect_ratios);
    const duration = numberList(row.supported_durations);
    return {
      ...(resolution.length ? { resolution } : {}),
      ...(aspectRatio.length ? { aspectRatio } : {}),
      ...(duration.length ? { duration } : {}),
    };
  }
  return {};
}

function enumValues(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const values = (value as { values?: unknown }).values;
  return Array.isArray(values) ? values.filter((item): item is string => typeof item === "string") : [];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

export async function openRouterQuote(modelId: string): Promise<OpenRouterQuote | null> {
  const credentials = await readCredentials();
  if (credentials.provider !== "openrouter") return null;
  let slug: string;
  try {
    slug = openRouterSlug(modelId);
  } catch {
    return null;
  }
  const model = getModel(modelId);
  if (model.surface === "video") {
    const priced = await videoSkus(credentials, slug);
    return priced ? { kind: "video", skus: priced.skus, sizes: priced.sizes } : null;
  }
  const lines = await imageLines(credentials, slug);
  return lines.length ? { kind: "image", lines } : null;
}

async function videoSkus(
  credentials: { apiKey: string; baseUrl: string },
  slug: string,
): Promise<{ skus: Record<string, number>; sizes: string[] } | null> {
  if (!videoSkuCache || Date.now() - videoSkuCache.at > PRICE_TTL_MS) {
    const payload = await openRouterJson(credentials, "/videos/models");
    const models = new Map<string, { skus: Record<string, number>; sizes: string[] }>();
    for (const item of asList(payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null)) {
      const row = asObject(item, "pricing");
      const id = row.id;
      if (typeof id !== "string") continue;
      const skus: Record<string, number> = {};
      for (const [key, raw] of Object.entries(asObject(row.pricing_skus, "pricing"))) {
        if (typeof raw !== "string" && typeof raw !== "number") continue;
        const usd = skuUsd(key, String(raw));
        if (usd !== null) skus[key] = usd;
      }
      models.set(id, { skus, sizes: stringList(row.supported_sizes) });
    }
    videoSkuCache = { at: Date.now(), models };
  }
  return videoSkuCache.models.get(slug) ?? null;
}

async function imageLines(credentials: { apiKey: string; baseUrl: string }, slug: string): Promise<ImagePriceLine[]> {
  const cached = imagePriceCache.get(slug);
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.lines;
    const payload = await openRouterJson(credentials, `/images/models/${slug}/endpoints`);
    const lines: ImagePriceLine[] = [];
    for (const endpoint of asList(
      payload && typeof payload === "object" ? (payload as { endpoints?: unknown }).endpoints : null,
    )) {
    for (const price of asList(asObject(endpoint, "pricing").pricing)) {
      const row = asObject(price, "pricing");
      const cost = Number(row.cost_usd);
      if (typeof row.billable !== "string" || typeof row.unit !== "string" || !Number.isFinite(cost)) continue;
      lines.push({
        billable: row.billable,
        unit: row.unit,
        costUsd: cost,
        ...(typeof row.variant === "string" ? { variant: row.variant } : {}),
      });
    }
  }
  imagePriceCache.set(slug, { at: Date.now(), lines });
  return lines;
}

async function openRouterJson(credentials: { apiKey: string; baseUrl: string }, path: string): Promise<unknown> {
  const response = await fetch(`${credentials.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${credentials.apiKey}` },
  });
  if (!response.ok) return null;
  return response.json() as Promise<unknown>;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function platformKeyKind(): Promise<KeyProvider | null> {
  return encryptedPlatformKeyKind();
}

export type GenerationSubmit = QueuedGeneration | { error: string };

export async function submitGeneration(plane: GenerationPlane): Promise<GenerationSubmit> {
  try {
    const credentials = await readCredentials();
    const caps = credentials.provider === "openrouter" ? await openRouterCapabilities(plane.model) : null;
    const model = overlayModel(getModel(plane.model), caps);
    const inlined = await inlineLocalMedia(plane);
    const parsed: GenerationPlane = {
      ...inlined,
      settings: parseSettings(model, snapSettings(model, plane.settings)),
    };
    if (credentials.provider === "higgsfield") {
      const { path, body } = toHiggsfield(parsed);
      const queued = await createHiggsfieldClient(credentials).submit(path, body);
      await rememberUsage(parsed, queued);
      return queued;
    }
    const { surface, body } = toPlatform(parsed);
    const client = createPlatformClient(credentials);
    const queued: QueuedGeneration =
      surface === "image" ? await client.submitImage(body) : await client.submitVideo(body);
    await rememberUsage(parsed, queued);
    return queued;
  } catch (caught) {
    return { error: submitError(caught) };
  }
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

async function rememberUsage(plane: GenerationPlane, queued: QueuedGeneration) {
  try {
    const quote = await openRouterQuote(plane.model).catch(() => null);
    const estimated = estimatePlaneUsd(quote, plane);
    const immediate = queued.immediate;
    const settled = immediate ? usageStatusFromPlatform(immediate.status) : null;
    const costUsd = immediate?.costUsd ?? estimated;
    await recordUsage({
      requestId: queued.requestId,
      modelId: plane.model,
      kind: getModel(plane.model).surface,
      spec: usageSpec(plane.settings),
      costUsd,
      status: settled ?? "pending",
    });
  } catch (caught) {
    console.error("[usage] record failed", caught instanceof Error ? caught.message : caught);
  }
}

/** Every request in flight, answered in one round trip. Next dispatches server
    actions one at a time per client, so a poll per run would queue ahead of the
    next submit — the fan-out belongs on this side of the call, where it is
    genuinely parallel. */
export async function getGenerationStatuses(data: unknown): Promise<StatusResult[]> {
  const requestIds = parseRequestIds(data);
  const credentials = await readCredentials();
  const client =
    credentials.provider === "higgsfield"
      ? createHiggsfieldClient(credentials)
      : createPlatformClient(credentials);
  return Promise.all(
    requestIds.map(async (requestId): Promise<StatusResult> => {
      try {
        const status = await client.status(requestId);
        const settled = usageStatusFromPlatform(status.status);
        if (settled) {
          await settleUsage({ requestId, status: settled, costUsd: status.costUsd }).catch((caught) => {
            console.error("[usage] settle failed", caught instanceof Error ? caught.message : caught);
          });
        }
        return { requestId, status };
      } catch (caught) {
        return { requestId, error: caught instanceof Error ? caught.message : String(caught) };
      }
    }),
  );
}

async function readCredentials() {
  try {
    const stored = await resolveUserCredentials();
    const { apiKey, provider } = stored;
    if (provider === "higgsfield") {
      const baseUrl = process.env.HF_API_BASE_URL;
      if (!baseUrl) throw new Error("Missing HF_API_BASE_URL");
      return { apiKey, baseUrl, provider };
    }
    return { apiKey, baseUrl: openRouterBaseUrl(), provider };
  } catch (caught) {
    if (caught instanceof MissingCredentialsError) throw caught;
    if (caught instanceof AuthRequiredError) throw caught;
    if (caught instanceof Error && caught.message.includes("Missing platform key")) {
      throw new MissingCredentialsError();
    }
    throw caught;
  }
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
