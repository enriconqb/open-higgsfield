import type { ModelEntry, SettingField } from "./catalog/types";

export type OpenRouterCaps = {
  resolution?: string[];
  aspectRatio?: string[];
  duration?: number[];
  quality?: string[];
};

export function overlayModel(model: ModelEntry, caps: OpenRouterCaps | null): ModelEntry {
  if (!caps) return model;
  const settings = { ...model.settings };
  const resolution = resolutionField(caps.resolution, model.settings.resolution);
  const aspectRatio = enumField(caps.aspectRatio, model.settings.aspectRatio);
  if (resolution) settings.resolution = resolution;
  else delete settings.resolution;
  const quality = enumField(caps.quality, model.settings.quality);
  if (!resolution && quality) settings.quality = quality;
  if (model.settings.aspectRatio) {
    if (aspectRatio) settings.aspectRatio = aspectRatio;
    else delete settings.aspectRatio;
  }
  const duration = model.settings.duration ? durationField(caps.duration, model.settings.duration) : undefined;
  if (duration) settings.duration = duration;
  return { ...model, settings };
}

export function snapSettings(
  model: ModelEntry,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...raw };
  for (const [key, field] of Object.entries(model.settings)) {
    const value = raw[key];
    if (field.type === "range") {
      const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
      const picked = Number.isFinite(numeric) ? numeric : field.default;
      next[key] = Math.min(field.max, Math.max(field.min, picked));
      continue;
    }
    if (field.type !== "enum") continue;
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
    const match = field.values.find((item) => item.toLowerCase() === text.toLowerCase());
    if (match) next[key] = match;
    else if (key === "duration" && typeof value === "number") next[key] = nearest(field.values, value);
    else next[key] = field.default;
  }
  return next;
}

const RESOLUTION_ORDER = ["480p", "720p", "1080p", "4k", "512", "768", "1k", "1.5k", "2k", "4k-image"];

/** Catalog values stay until OpenRouter names the same size; the provider spelling is what gets sent. */
export function mergeResolutions(catalog: readonly string[], extra: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of catalog) {
    if (!value) continue;
    const key = resolutionKey(value);
    if (!byKey.has(key)) byKey.set(key, value);
  }
  for (const value of extra) {
    if (!value) continue;
    byKey.set(resolutionKey(value), value);
  }
  const entries = [...byKey.entries()];
  /* Image sizes share the letters "4k" with video. On a list that is only image
     sizes, that value belongs after 2K, not up with the video tiers. */
  const imageList =
    entries.some(([key]) => IMAGE_SIZE.has(key)) && !entries.some(([key]) => VIDEO_TIER.has(key));
  return entries
    .sort((a, b) => {
      const left = imageList && a[0] === "4k" ? "4k-image" : a[0];
      const right = imageList && b[0] === "4k" ? "4k-image" : b[0];
      return resolutionRank(left) - resolutionRank(right) || a[1].localeCompare(b[1]);
    })
    .map(([, label]) => label);
}

const IMAGE_SIZE = new Set(["512", "768", "1k", "1.5k", "2k", "4k-image"]);
const VIDEO_TIER = new Set(["480p", "720p", "1080p"]);

function resolutionField(values: string[] | undefined, current: SettingField | undefined): SettingField | undefined {
  const catalog = current?.type === "enum" ? current.values : [];
  const merged = mergeResolutions(catalog, values ?? []);
  if (!merged.length) return undefined;
  return { type: "enum", values: merged, default: merged[0]! };
}

function resolutionKey(value: string): string {
  const lower = value.trim().toLowerCase();
  if (/^\d+$/.test(lower) && ["480", "720", "1080"].includes(lower)) return `${lower}p`;
  return lower;
}

function resolutionRank(key: string): number {
  const index = RESOLUTION_ORDER.indexOf(key);
  return index === -1 ? RESOLUTION_ORDER.length : index;
}

function enumField(values: string[] | undefined, current: SettingField | undefined): SettingField | undefined {
  if (!values?.length) return undefined;
  const fallback = current?.type === "enum" ? current.default : values[0]!;
  const match = values.find((item) => item.toLowerCase() === fallback.toLowerCase());
  return { type: "enum", values, default: match ?? values[0]! };
}

function durationField(values: number[] | undefined, current: SettingField | undefined): SettingField | undefined {
  if (!values?.length) return undefined;
  const unique = [...new Set(values.filter((item) => Number.isFinite(item)))].sort((a, b) => a - b);
  if (!unique.length) return undefined;
  const contiguous = unique.length > 1 && unique.every((item, index) => index === 0 || item === unique[index - 1]! + 1);
  if (contiguous) {
    const min = unique[0]!;
    const max = unique[unique.length - 1]!;
    const preferred = current?.type === "range" ? current.default : Number(current?.default);
    const fallback = Number.isFinite(preferred) ? Math.min(max, Math.max(min, preferred)) : min;
    return { type: "range", min, max, step: 1, default: fallback };
  }
  const texts = unique.map(String);
  const fallback = current?.type === "enum" ? current.default : texts[0]!;
  const match = texts.find((item) => item === fallback);
  return { type: "enum", values: texts, default: match ?? texts[0]! };
}

function nearest(values: readonly string[], target: number): string {
  return values.reduce((best, item) =>
    Math.abs(Number(item) - target) < Math.abs(Number(best) - target) ? item : best,
  );
}
