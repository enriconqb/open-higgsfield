import type { ModelEntry, SettingField } from "./catalog/types";

export type OpenRouterCaps = {
  resolution?: string[];
  aspectRatio?: string[];
  duration?: number[];
};

export function overlayModel(model: ModelEntry, caps: OpenRouterCaps | null): ModelEntry {
  if (!caps) return model;
  const settings = { ...model.settings };
  const resolution = enumField(caps.resolution, model.settings.resolution);
  const aspectRatio = enumField(caps.aspectRatio, model.settings.aspectRatio);
  if (resolution) settings.resolution = resolution;
  else delete settings.resolution;
  if (aspectRatio) settings.aspectRatio = aspectRatio;
  else delete settings.aspectRatio;
  if (caps.duration?.length) {
    const values = caps.duration.map(String);
    settings.duration = { type: "enum", values, default: values[0]! };
  }
  return { ...model, settings };
}

export function snapSettings(
  model: ModelEntry,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...raw };
  for (const [key, field] of Object.entries(model.settings)) {
    if (field.type !== "enum") continue;
    const value = raw[key];
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

function nearest(values: readonly string[], target: number): string {
  return values.reduce((best, item) =>
    Math.abs(Number(item) - target) < Math.abs(Number(best) - target) ? item : best,
  );
}
