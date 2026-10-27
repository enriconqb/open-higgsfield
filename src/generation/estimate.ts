export type ImagePriceLine = {
  billable: string;
  unit: string;
  costUsd: number;
  variant?: string;
};

export type OpenRouterQuote =
  | { kind: "video"; skus: Record<string, number>; sizes?: string[] }
  | { kind: "image"; lines: ImagePriceLine[] };

export type EstimateInput = {
  resolution?: string;
  aspectRatio?: string;
  duration?: number;
  audio?: boolean;
  images: number;
  videos: number;
  audios: number;
  batch: number;
};

/** USD from a cached OpenRouter price table and the controls the user has set. */
export function estimateUsd(quote: OpenRouterQuote, input: EstimateInput): number | null {
  const total = quote.kind === "video" ? estimateVideo(quote.skus, quote.sizes, input) : estimateImage(quote.lines, input);
  if (total === null || !Number.isFinite(total) || total <= 0) return null;
  return total;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(amount >= 1 ? 2 : 3)}`;
}

function estimateVideo(skus: Record<string, number>, sizes: string[] | undefined, input: EstimateInput): number | null {
  const duration = input.duration && input.duration > 0 ? input.duration : 0;
  const perSecond = outputPerSecond(skus, input.resolution, input.audio, input.videos > 0);
  const tokens = perSecond === undefined ? tokenUsd(skus, sizes, input, duration) : 0;
  let total = perSecond !== undefined && duration > 0 ? perSecond * duration : tokens;
  total += imageInputRate(skus) * input.images;
  total +=
    (firstSku(
      skus,
      (key) => /audio/.test(key) && /input|reference/.test(key) && !/second|duration/.test(key),
    ) ?? 0) * input.audios;
  const floor = firstSku(skus, (key) => key.includes("minimum"));
  if (floor !== undefined) total = Math.max(total, floor);
  return total > 0 ? total : null;
}

function estimateImage(lines: ImagePriceLine[], input: EstimateInput): number | null {
  const resolution = (input.resolution ?? "").toLowerCase();
  const output = matchingLine(lines, "output_image", resolution);
  const incoming = matchingLine(lines, "input_image", resolution) ?? matchingLine(lines, "input_reference", resolution);
  let total = 0;
  if (output) total += lineCost(output, resolution) * Math.max(1, input.batch);
  if (incoming) total += lineCost(incoming, resolution) * input.images;
  return total > 0 ? total : null;
}

function outputPerSecond(
  skus: Record<string, number>,
  resolution: string | undefined,
  audio: boolean | undefined,
  videoInput: boolean,
): number | undefined {
  const res = (resolution ?? "").toLowerCase();
  const entries = Object.entries(skus).filter(([key]) => /second|duration/.test(key) && !/token|megapixel|minimum/.test(key));
  const pool = videoInput && entries.some(([key]) => /continuation|with_video/.test(key))
    ? entries.filter(([key]) => /continuation|with_video/.test(key))
    : entries.filter(([key]) => !/continuation|reference_duration|reference_input/.test(key));
  const audioPool = pool.filter(([key]) => (audio ? /with_audio/.test(key) : /without_audio/.test(key)));
  const ranked = (audioPool.length ? audioPool : pool.filter(([key]) => !/with_audio|without_audio/.test(key))).slice();
  ranked.sort((a, b) => score(b[0], res) - score(a[0], res));
  const best = ranked[0];
  return best && score(best[0], res) > 0 ? best[1] : undefined;
}

function score(key: string, resolution: string): number {
  let value = 1;
  if (resolution && key.toLowerCase().includes(resolution)) value += 4;
  if (/_output|duration_seconds/.test(key)) value += 1;
  return value;
}

const FPS = 24;
const SHORT_SIDE: Record<string, number> = { "480p": 480, "720p": 720, "1080p": 1080, "4k": 2160 };

function tokenUsd(
  skus: Record<string, number>,
  sizes: string[] | undefined,
  input: EstimateInput,
  duration: number,
): number {
  const rate = tokenRate(skus, input.resolution, input.audio, input.videos > 0);
  const frame = frameSize(sizes, input.resolution, input.aspectRatio);
  if (rate === undefined || !frame || duration <= 0) return 0;
  return ((frame.width * frame.height * duration * FPS) / 1024) * rate;
}

function tokenRate(
  skus: Record<string, number>,
  resolution: string | undefined,
  audio: boolean | undefined,
  videoInput: boolean,
): number | undefined {
  const entries = Object.entries(skus).filter(([key]) => key.includes("video_tokens"));
  if (!entries.length) return undefined;
  const pool = entries.filter(([key]) =>
    videoInput ? key.includes("with_video_input") : !key.includes("with_video_input"),
  );
  const ranked = (pool.length ? pool : entries).slice();
  const res = (resolution ?? "").toLowerCase();
  ranked.sort((a, b) => tokenScore(b[0], res, audio) - tokenScore(a[0], res, audio));
  return ranked[0]?.[1];
}

function tokenScore(key: string, resolution: string, audio: boolean | undefined): number {
  let value = 1;
  if (resolution && key.toLowerCase().includes(resolution)) value += 4;
  if (audio === false && key.includes("without_audio")) value += 2;
  if (audio !== false && key === "video_tokens") value += 2;
  return value;
}

function frameSize(
  sizes: string[] | undefined,
  resolution: string | undefined,
  aspectRatio: string | undefined,
): { width: number; height: number } | null {
  const tier = SHORT_SIDE[(resolution ?? "720p").toLowerCase()];
  if (!tier) return null;
  const parsed = (sizes ?? []).flatMap((size) => {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match) return [];
    return [{ width: Number(match[1]), height: Number(match[2]) }];
  });
  const bucket = parsed.filter((size) => nearestTier(Math.min(size.width, size.height)) === tier);
  const ratio = aspectNumber(aspectRatio) ?? 16 / 9;
  const list = bucket.length ? bucket : [fallbackFrame(tier, ratio)];
  return list.reduce((best, item) =>
    Math.abs(item.width / item.height - ratio) < Math.abs(best.width / best.height - ratio) ? item : best,
  );
}

function nearestTier(short: number): number {
  return [480, 720, 1080, 2160].reduce((best, item) =>
    Math.abs(item - short) < Math.abs(best - short) ? item : best,
  );
}

function fallbackFrame(short: number, ratio: number): { width: number; height: number } {
  const landscape = ratio >= 1;
  const long = Math.round((short * Math.max(ratio, 1 / ratio)) / 2) * 2;
  return landscape ? { width: long, height: short } : { width: short, height: long };
}

function aspectNumber(value: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value ?? "");
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  return width / height;
}

function imageInputRate(skus: Record<string, number>): number {
  return (
    firstSku(skus, (key) => /per_image_input|reference_images|reference_input_images/.test(key)) ?? 0
  );
}

function firstSku(skus: Record<string, number>, test: (key: string) => boolean): number | undefined {
  const found = Object.entries(skus).find(([key]) => test(key));
  return found ? found[1] : undefined;
}

function matchingLine(lines: ImagePriceLine[], billable: string, resolution: string): ImagePriceLine | undefined {
  const group = lines.filter((line) => line.billable === billable);
  return (
    group.find((line) => line.variant && resolution.includes(line.variant.toLowerCase())) ??
    group.find((line) => !line.variant)
  );
}

function lineCost(line: ImagePriceLine, resolution: string): number {
  if (line.unit === "image") return line.costUsd;
  if (line.unit === "megapixel") return line.costUsd * megapixels(resolution);
  return 0;
}

function megapixels(resolution: string): number {
  if (resolution.includes("4k")) return 8;
  if (resolution.includes("2k")) return 4;
  if (resolution.includes("1080")) return 2;
  return 1;
}

/** `cents_*` SKUs are cents; every other video SKU on this API is USD. */
export function skuUsd(key: string, raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return key.includes("cents") ? value / 100 : value;
}
