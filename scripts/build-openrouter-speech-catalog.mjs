import { writeFileSync } from "node:fs";

/** Studio-curated TTS entries in tts.ts win over generated `or-*` duplicates. */
const claimed = new Set([
  "mistralai/voxtral-mini-tts-2603",
  "elevenlabs/eleven-flash-v2.5",
  "elevenlabs/eleven-multilingual-v2",
  "hexgrad/kokoro-82m",
  "x-ai/grok-voice-tts-1.0",
]);

function idOf(slug) {
  return `or-${slug.replace(/[/.]/g, "-")}`;
}

function labelOf(model) {
  return String(model.name || model.id).replace(/^[^:]+:\s*/, "");
}

function speechParams(model) {
  const modalities = Array.isArray(model.output_modalities) ? model.output_modalities : [];
  const speech = modalities.find((item) => item && item.type === "speech");
  return speech?.supported_parameters && typeof speech.supported_parameters === "object"
    ? speech.supported_parameters
    : {};
}

function enumValues(field) {
  if (!field || typeof field !== "object") return [];
  if (field.type !== "enum" || !Array.isArray(field.values)) return [];
  return field.values.filter((item) => typeof item === "string" && item.length > 0);
}

function speedRange(field) {
  if (!field || typeof field !== "object" || field.type !== "range") return null;
  const min = Number(field.min);
  const max = Number(field.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
  return { min, max };
}

function settingsLiteral(params) {
  const voices = enumValues(params.voice);
  const formats = enumValues(params.response_format);
  const speed = speedRange(params.speed);
  const parts = [];
  if (voices.length) {
    parts.push(
      `voice: { type: "enum", values: ${JSON.stringify(voices)}, default: ${JSON.stringify(voices[0])} }`,
    );
  }
  if (formats.length) {
    const preferred = formats.includes("mp3") ? "mp3" : formats[0];
    parts.push(
      `outputFormat: { type: "enum", values: ${JSON.stringify(formats)}, default: ${JSON.stringify(preferred)} }`,
    );
  }
  if (speed) {
    const mid = Math.min(speed.max, Math.max(speed.min, 1));
    parts.push(
      `speed: { type: "range", min: ${speed.min}, max: ${speed.max}, default: ${mid}, step: 0.05 }`,
    );
  }
  return `{ ${parts.join(", ")} }`;
}

const speech = await (await fetch("https://openrouter.ai/api/v1/audio/speech/models")).json();
const rows = Array.isArray(speech.data) ? speech.data : [];
const lines = [];
const slugs = [];
const order = [];

for (const model of rows) {
  if (!model?.id || typeof model.id !== "string") continue;
  order.push(model.id);
  if (claimed.has(model.id)) continue;
  const id = idOf(model.id);
  const label = labelOf(model);
  const params = speechParams(model);
  slugs.push([id, model.id]);
  lines.push(
    `  speechModel(${JSON.stringify(id)}, ${JSON.stringify(label)}, ${settingsLiteral(params)}),`,
  );
}

const file = `import { speechModel } from "./defaults";
import type { ModelEntry } from "./types";

/** OpenRouter speech models not already a studio TTS entry. Generated from /audio/speech/models. */
export const OPENROUTER_SPEECH_EXTRAS: readonly ModelEntry[] = [
${lines.join("\n")}
];

export const OPENROUTER_SPEECH_EXTRA_SLUGS: Record<string, string> = {
${slugs.map(([id, slug]) => `  ${JSON.stringify(id)}: ${JSON.stringify(slug)},`).join("\n")}
};

/** Live speech catalog order from OpenRouter (includes claimed studio slugs). */
export const OPENROUTER_SPEECH_SLUG_ORDER: readonly string[] = ${JSON.stringify(order, null, 2)};
`;

writeFileSync(new URL("../src/generation/catalog/openrouter-speech-extra.ts", import.meta.url), file);
console.log(`wrote ${lines.length} speech extras (${order.length} speech models total)`);
