import { toAuthorizationHeader } from "./credentials";

const DEFAULT_BASE = "https://openrouter.ai/api/v1";

export class PlatformError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(messageFromBody(status, body));
    this.name = "PlatformError";
    this.status = status;
    this.body = body;
  }
}

export type QueuedGeneration = {
  status: string;
  requestId: string;
  statusUrl: string;
  cancelUrl: string;
  /** Image jobs finish inside submit; the studio skips polling when this is set. */
  immediate?: GenerationStatus;
};

export type GenerationStatus = {
  status: string;
  requestId: string;
  images?: Array<{ url: string }>;
  video?: { url: string };
  error?: unknown;
};

export type StatusResult =
  | { requestId: string; status: GenerationStatus }
  | { requestId: string; error: string };

export type PlatformClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const HIGGSFIELD_MODEL = /^[a-z0-9][a-z0-9._/-]*$/i;

export function createHiggsfieldClient(options: PlatformClientOptions) {
  const baseUrl = (options.baseUrl || "").replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const auth = toAuthorizationHeader(options.apiKey, "higgsfield");

  async function send(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: auth,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await readJson(response);
    if (!response.ok) throw new PlatformError(response.status, payload);
    return payload;
  }

  return {
    async submit(path: string, input: Record<string, unknown>): Promise<QueuedGeneration> {
      if (!HIGGSFIELD_MODEL.test(path) || path.includes("..")) {
        throw new PlatformError(400, { detail: "Invalid model" });
      }
      return mapHiggsfieldQueued(await send("POST", `/${path}`, input));
    },
    async status(requestId: string): Promise<GenerationStatus> {
      if (!requestId) throw new PlatformError(400, { detail: "Missing request id" });
      return mapHiggsfieldStatus(await send("GET", `/requests/${encodeURIComponent(requestId)}/status`));
    },
  };
}

function mapHiggsfieldQueued(payload: unknown): QueuedGeneration {
  const data = asRecord(payload);
  const requestId = stringField(data, "request_id");
  if (!requestId) throw new PlatformError(502, { detail: "Platform response missing request_id" });
  return {
    status: stringField(data, "status") ?? "queued",
    requestId,
    statusUrl: stringField(data, "status_url") ?? "",
    cancelUrl: stringField(data, "cancel_url") ?? "",
  };
}

function mapHiggsfieldStatus(payload: unknown): GenerationStatus {
  const data = asRecord(payload);
  const images = Array.isArray(data.images)
    ? data.images.flatMap((item) => {
        const url = asRecord(item).url;
        return typeof url === "string" ? [{ url }] : [];
      })
    : undefined;
  const videoUrl = asRecord(data.video).url;
  return {
    status: stringField(data, "status") ?? "unknown",
    requestId: stringField(data, "request_id") ?? "",
    ...(images?.length ? { images } : {}),
    ...(typeof videoUrl === "string" ? { video: { url: videoUrl } } : {}),
    ...(data.error !== undefined ? { error: data.error } : {}),
  };
}

export function openRouterBaseUrl(): string {
  return (process.env.OPENROUTER_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
}

export function createPlatformClient(options: PlatformClientOptions) {
  const baseUrl = (options.baseUrl || openRouterBaseUrl()).replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const auth = toAuthorizationHeader(options.apiKey, "openrouter");

  async function send(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
    const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
    console.info("[platform] request", { method, url, body: body ?? null });
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: auth,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const payload = await readJson(response);
    console.info("[platform] response", { method, url, status: response.status, body: summarize(payload) });
    if (!response.ok) throw new PlatformError(response.status, payload);
    return payload;
  }

  return {
    async submitVideo(input: Record<string, unknown>): Promise<QueuedGeneration> {
      const queued = mapQueued(await send("POST", "/videos", input));
      return queued;
    },
    async submitImage(input: Record<string, unknown>): Promise<QueuedGeneration> {
      const payload = await send("POST", "/images", input);
      const images = mapImages(payload);
      const requestId = `img-${crypto.randomUUID()}`;
      const immediate: GenerationStatus = {
        status: images.length ? "completed" : "failed",
        requestId,
        ...(images.length ? { images } : { error: "Image response had no data" }),
      };
      return {
        status: immediate.status,
        requestId,
        statusUrl: "",
        cancelUrl: "",
        immediate,
      };
    },
    async status(requestId: string): Promise<GenerationStatus> {
      if (!requestId) throw new PlatformError(400, { detail: "Missing request id" });
      return mapStatus(await send("GET", `/videos/${encodeURIComponent(requestId)}`), requestId);
    },
  };
}

function mapQueued(payload: unknown): QueuedGeneration {
  const data = asRecord(payload);
  const requestId = stringField(data, "id") ?? stringField(data, "generation_id");
  if (!requestId) throw new PlatformError(502, { detail: "OpenRouter response missing id" });
  const polling = stringField(data, "polling_url") ?? "";
  return {
    status: normalizeStatus(stringField(data, "status") ?? "pending"),
    requestId,
    statusUrl: polling.startsWith("http") ? polling : polling ? `https://openrouter.ai${polling}` : "",
    cancelUrl: "",
  };
}

function mapStatus(payload: unknown, requestId: string): GenerationStatus {
  const data = asRecord(payload);
  const id = stringField(data, "id") ?? requestId;
  const videoUrl = playableVideoUrl(data, id);
  const error = data.error;

  return {
    status: normalizeStatus(stringField(data, "status") ?? "unknown"),
    requestId: id,
    ...(videoUrl ? { video: { url: videoUrl } } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function playableVideoUrl(data: Record<string, unknown>, jobId: string): string | undefined {
  const signed = stringList(data.urls)[0];
  if (signed) return signed;
  if (stringList(data.unsigned_urls).length && jobId) {
    return `/api/media?job=${encodeURIComponent(jobId)}&index=0`;
  }
  return undefined;
}

function mapImages(payload: unknown): Array<{ url: string }> {
  const data = asRecord(payload).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const row = asRecord(item);
    const b64 = row.b64_json;
    if (typeof b64 !== "string" || !b64) return [];
    const media = typeof row.media_type === "string" ? row.media_type : "image/png";
    return [{ url: `data:${media};base64,${b64}` }];
  });
}

function normalizeStatus(status: string): string {
  if (status === "cancelled") return "canceled";
  if (status === "expired") return "failed";
  return status;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function summarize(payload: unknown): unknown {
  const data = asRecord(payload);
  const images = asRecord(payload).data;
  if (Array.isArray(images)) {
    return { ...data, data: images.map(() => ({ b64_json: "[omitted]" })) };
  }
  return payload;
}

function messageFromBody(status: number, body: unknown): string {
  const record = asRecord(body);
  const detail = record.detail;
  if (typeof detail === "string" && detail) return detail;
  const error = asRecord(record.error);
  if (typeof error.message === "string" && error.message) return error.message;
  if (typeof record.error === "string" && record.error) return record.error;
  const message = record.message;
  if (typeof message === "string" && message) return message;
  return `OpenRouter request failed (${status})`;
}
