import { estimatePlaneUsd, recordUsage, settleUsage, usageSpec, usageStatusFromPlatform } from "@/usage/record";

import { overlayModel, snapSettings } from "./capabilities";
import type { OpenRouterCaps } from "./capabilities";
import { getModel, parseSettings } from "./catalog";
import { openRouterSlug } from "./catalog/openrouter-slugs";
import type { GenerationPlane, MediaRole } from "./catalog/types";
import { toAuthorizationHeader } from "./credentials";
import type { KeyProvider } from "./credentials";
import type { ImagePriceLine, OpenRouterQuote } from "./estimate";
import { skuUsd } from "./estimate";
import { ensureArchivedUrl } from "./archive-media";
import { inlineLocalMedia } from "./local-upload";
import {
  createHiggsfieldClient,
  createPlatformClient,
  firstPublicVideoUrl,
  openRouterBaseUrl,
} from "./platform";
import type { GenerationStatus, QueuedGeneration, StatusResult } from "./platform";
import { toHiggsfield } from "./to-higgsfield";
import { toPlatform } from "./to-platform";

export type GenerationCredentials = {
  apiKey: string;
  baseUrl: string;
  provider: KeyProvider;
};

/** Everything a generation needs besides the plane itself. The studio builds it
    from the session cookie, /api/v1 builds it from a bearer token. */
export type GenerationContext = {
  userId: number;
  credentials: GenerationCredentials;
  /** Absolute origin of the incoming request, for URLs the platform must fetch. */
  origin: string;
  /** API token that started the work, so usage rows can point back at it. */
  tokenId?: number | null;
};

const PRICE_TTL_MS = 5 * 60_000;

let videoSkuCache: { at: number; models: Map<string, { skus: Record<string, number>; sizes: string[] }> } | null =
  null;
const imagePriceCache = new Map<string, { at: number; lines: ImagePriceLine[] }>();
const capsCache = new Map<string, { at: number; caps: OpenRouterCaps }>();

export function originOf(request: Request): string {
  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

export async function capabilitiesFor(
  context: GenerationContext,
  modelId: string,
): Promise<OpenRouterCaps | null> {
  if (context.credentials.provider !== "openrouter") return null;
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
    model.surface === "image"
      ? await imageCaps(context.credentials, slug)
      : await videoCaps(context.credentials, slug);
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

export async function quoteFor(
  context: GenerationContext,
  modelId: string,
): Promise<OpenRouterQuote | null> {
  if (context.credentials.provider !== "openrouter") return null;
  let slug: string;
  try {
    slug = openRouterSlug(modelId);
  } catch {
    return null;
  }
  const model = getModel(modelId);
  if (model.surface === "video") {
    const priced = await videoSkus(context.credentials, slug);
    return priced ? { kind: "video", skus: priced.skus, sizes: priced.sizes } : null;
  }
  const lines = await imageLines(context.credentials, slug);
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

async function imageLines(
  credentials: { apiKey: string; baseUrl: string },
  slug: string,
): Promise<ImagePriceLine[]> {
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

async function openRouterJson(
  credentials: { apiKey: string; baseUrl: string },
  path: string,
): Promise<unknown> {
  const response = await fetch(`${credentials.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${credentials.apiKey}` },
  });
  if (!response.ok) return null;
  return response.json() as Promise<unknown>;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Snaps settings to the model, inlines local references, and submits. Throws so
    each caller can map the failure to its own surface (studio text or HTTP). */
export async function submitPlane(
  context: GenerationContext,
  plane: GenerationPlane,
): Promise<QueuedGeneration> {
  const credentials = context.credentials;
  const caps = credentials.provider === "openrouter" ? await capabilitiesFor(context, plane.model) : null;
  const model = overlayModel(getModel(plane.model), caps);
  const inlined = await inlineLocalMedia(plane);
  const hosted =
    credentials.provider === "openrouter"
      ? await resolveMediaProxies(inlined, credentials.apiKey, context.origin)
      : inlined;
  const parsed: GenerationPlane = {
    ...hosted,
    settings: parseSettings(model, snapSettings(model, plane.settings)),
  };
  if (credentials.provider === "higgsfield") {
    const { path, body } = toHiggsfield(parsed);
    const queued = await createHiggsfieldClient(credentials).submit(path, body);
    await rememberUsage(context, parsed, queued);
    return queued;
  }
  const { surface, body } = toPlatform(parsed);
  const client = createPlatformClient(credentials);
  const queued: QueuedGeneration =
    surface === "image" ? await client.submitImage(body) : await client.submitVideo(body);
  await rememberUsage(context, parsed, queued);
  if (queued.immediate) {
    queued.immediate = await archiveGenerationStatus(context, queued.requestId, queued.immediate);
  }
  return queued;
}

async function rememberUsage(
  context: GenerationContext,
  plane: GenerationPlane,
  queued: QueuedGeneration,
): Promise<void> {
  try {
    const quote = await quoteFor(context, plane.model).catch(() => null);
    const estimated = estimatePlaneUsd(quote, plane);
    const immediate = queued.immediate;
    const settled = immediate ? usageStatusFromPlatform(immediate.status) : null;
    const costUsd = immediate?.costUsd ?? estimated;
    await recordUsage({
      userId: context.userId,
      tokenId: context.tokenId ?? null,
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

/** Every request in flight, answered in one round trip. */
export async function statusesFor(
  context: GenerationContext,
  requestIds: string[],
): Promise<StatusResult[]> {
  const credentials = context.credentials;
  const client =
    credentials.provider === "higgsfield"
      ? createHiggsfieldClient(credentials)
      : createPlatformClient(credentials);
  return Promise.all(
    requestIds.map(async (requestId): Promise<StatusResult> => {
      try {
        const raw = await client.status(requestId);
        const status = await archiveGenerationStatus(context, requestId, raw);
        const settled = usageStatusFromPlatform(status.status);
        if (settled) {
          await settleUsage({
            userId: context.userId,
            requestId,
            status: settled,
            costUsd: status.costUsd,
          }).catch((caught) => {
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

async function archiveGenerationStatus(
  context: GenerationContext,
  requestId: string,
  status: GenerationStatus,
): Promise<GenerationStatus> {
  if (status.status !== "completed") return status;
  const images = status.images
    ? await Promise.all(
        status.images.map(async (image, index) => ({
          url: await ensureArchivedUrl({
            url: image.url,
            userId: context.userId,
            requestId,
            index,
            mime: "image/png",
          }),
        })),
      )
    : undefined;
  let video = status.video;
  if (video) {
    const index = images?.length ?? 0;
    const original = video.url;
    const proxy = /\/api\/media\?/.test(original);
    const local = await ensureArchivedUrl({
      url: original,
      userId: context.userId,
      requestId,
      index,
      mime: "video/mp4",
      ...(proxy
        ? {
            fetchBytes: () => fetchProxiedVideo(context.credentials.apiKey, original),
          }
        : {}),
    });
    const sourceUrl = await videoSourceUrl(context, original);
    video = {
      url: local,
      ...(sourceUrl && sourceUrl !== local ? { sourceUrl } : {}),
    };
  }
  return {
    ...status,
    ...(images ? { images } : {}),
    ...(video ? { video } : {}),
  };
}

async function videoSourceUrl(context: GenerationContext, url: string): Promise<string | undefined> {
  if (/^https:\/\//i.test(url)) return url;
  if (!/\/api\/media\?/.test(url) || context.credentials.provider !== "openrouter") return undefined;
  const job = mediaJobId(url);
  if (!job) return undefined;
  const signed = await signedVideoUrl(context.credentials.apiKey, job);
  return signed && /^https:\/\//i.test(signed) ? signed : undefined;
}

async function fetchProxiedVideo(apiKey: string, url: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const job = mediaJobId(url);
  if (!job) return null;
  const index = Number(new URL(url, "http://local").searchParams.get("index") ?? "0");
  const upstream = await fetch(
    `${openRouterBaseUrl()}/videos/${encodeURIComponent(job)}/content?index=${Number.isInteger(index) ? index : 0}`,
    { headers: { Authorization: toAuthorizationHeader(apiKey, "openrouter") }, signal: AbortSignal.timeout(120_000) },
  );
  if (!upstream.ok) return null;
  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (!bytes.byteLength) return null;
  return { bytes, mime: upstream.headers.get("Content-Type") || "video/mp4" };
}

const MEDIA_JOB = /\/api\/media\?job=([^&#]+)/;

function mediaJobId(url: string): string | null {
  const match = MEDIA_JOB.exec(url);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** `/api/media` is only playable in this app. A public job URL replaces it when one exists. */
async function resolveMediaProxies(
  plane: GenerationPlane,
  apiKey: string,
  origin: string,
): Promise<GenerationPlane> {
  const resolved = new Map<string, string>();
  async function absolute(url: string): Promise<string> {
    const job = mediaJobId(url);
    if (job) {
      const cached = resolved.get(job);
      if (cached) return cached;
      const signed = await signedVideoUrl(apiKey, job);
      if (signed) {
        resolved.set(job, signed);
        return signed;
      }
    }
    return url.startsWith("/") && origin ? `${origin}${url}` : url;
  }
  const media: GenerationPlane["media"] = { ...plane.media };
  for (const role of ["video", "audio"] as const satisfies readonly MediaRole[]) {
    const items = media[role];
    if (!items) continue;
    media[role] = await Promise.all(items.map(async (item) => ({ ...item, url: await absolute(item.url) })));
  }
  return { ...plane, media };
}

async function signedVideoUrl(apiKey: string, jobId: string): Promise<string | null> {
  const auth = toAuthorizationHeader(apiKey, "openrouter");
  const base = openRouterBaseUrl();
  const status = await fetch(`${base}/videos/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: auth },
  });
  if (status.ok) {
    const payload = (await status.json().catch(() => null)) as { urls?: unknown; unsigned_urls?: unknown } | null;
    const listed = Array.isArray(payload?.urls) ? payload.urls : [];
    for (const item of listed) {
      const url = absoluteMediaUrl(item);
      if (url) return url;
    }
    const published = firstPublicVideoUrl(payload?.unsigned_urls);
    if (published) return published;
  }
  return publicContentUrl(`${base}/videos/${encodeURIComponent(jobId)}/content?index=0`, auth);
}

function absoluteMediaUrl(value: unknown): string | null {
  if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  if (value !== null && typeof value === "object" && "url" in value) {
    const url = (value as { url?: unknown }).url;
    if (typeof url === "string" && /^https?:\/\//.test(url)) return url;
  }
  return null;
}

/** The content route redirects to a CDN URL the provider can fetch. */
async function publicContentUrl(start: string, auth: string): Promise<string | null> {
  let current = start;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(current, { headers: { Authorization: auth }, redirect: "manual" });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return null;
    const next = new URL(location, current).href;
    if (/^https?:\/\//.test(next) && !/openrouter\.ai/i.test(new URL(next).host)) return next;
    current = next;
  }
  return null;
}

function asObject(data: unknown, message: string): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error(message);
  return data as Record<string, unknown>;
}
