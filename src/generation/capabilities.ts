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
  const resolution = enumField(caps.resolution, model.settings.resolution);
  const aspectRatio = enumField(caps.aspectRatio, model.settings.aspectRatio);
  if (resolution) settings.resolution = resolution;
  else delete settings.resolution;
  const quality = enumField(caps.quality, model.settings.quality);
  if (!resolution && quality) settings.quality = quality;
  if (aspectRatio) settings.aspectRatio = aspectRatio;
  else delete settings.aspectRatio;
  const duration = durationField(caps.duration, model.settings.duration);
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
