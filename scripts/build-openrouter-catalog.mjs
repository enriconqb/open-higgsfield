import { writeFileSync } from "node:fs";

const claimed = new Set([
  "bytedance/seedance-2.5",
  "bytedance/seedance-2.0",
  "bytedance/seedance-2.0-fast",
  "bytedance/seedance-2.0-mini",
  "kwaivgi/kling-v3.0-std",
  "kwaivgi/kling-v3.0-pro",
  "kwaivgi/kling-video-o1",
  "alibaba/wan-3.0",
  "alibaba/wan-3.0-prime",
  "alibaba/wan-2.7",
  "alibaba/wan-2.6",
  "minimax/hailuo-3",
  "minimax/hailuo-2.3",
  "alibaba/happyhorse-1.0",
  "alibaba/happyhorse-1.1",
  "x-ai/grok-imagine-video-1.5",
  "black-forest-labs/flux-3-video",
  "black-forest-labs/flux.2-pro",
  "x-ai/grok-imagine-image-2.0",
  "recraft/recraft-v4.1",
  "qwen/qwen-image-3",
]);

function idOf(slug) {
  return `or-${slug.replace(/[/.]/g, "-")}`;
}

function labelOf(model) {
  return String(model.name || model.id).replace(/^[^:]+:\s*/, "");
}

const video = await (await fetch("https://openrouter.ai/api/v1/videos/models")).json();
const image = await (await fetch("https://openrouter.ai/api/v1/images/models")).json();
const lines = [];
const slugs = [];

function push(model, surface) {
  if (claimed.has(model.id)) return;
  const id = idOf(model.id);
  const label = labelOf(model);
  slugs.push([id, model.id]);
  if (surface === "image") {
    lines.push(
      `  imageModel(${JSON.stringify(id)}, ${JSON.stringify(label)}, { text: ${JSON.stringify(model.id)} }),`,
    );
    return;
  }
  if (String(model.id).includes("upscale")) {
    lines.push(`  {
    id: ${JSON.stringify(id)},
    surface: "video",
    label: ${JSON.stringify(label)},
    roles: { video: 1 },
    settings: { upscaleFactor: { type: "enum", values: ["2", "4"], default: "2" } },
    paths: { text: ${JSON.stringify(model.id)} },
  },`);
    return;
  }
  const roles = String(model.id).includes("edit")
    ? "{ video: 1, reference: 4 }"
    : String(model.id).includes("seedance-2")
      ? "{ start: 1, end: 1, reference: 9, video: 3, audio: 3 }"
      : "{ start: 1, end: 1, reference: 4 }";
  lines.push(
    `  videoModel(${JSON.stringify(id)}, ${JSON.stringify(label)}, ${roles}, { text: ${JSON.stringify(model.id)} }),`,
  );
}

for (const model of video.data ?? []) push(model, "video");
for (const model of image.data ?? []) push(model, "image");

const file = `import { imageModel, videoModel } from "./defaults";
import type { ModelEntry } from "./types";

/** OpenRouter models that are not already a studio entry. Generated from the models API. */
export const OPENROUTER_EXTRAS: readonly ModelEntry[] = [
${lines.join("\n")}
];

export const OPENROUTER_EXTRA_SLUGS: Record<string, string> = {
${slugs.map(([id, slug]) => `  ${JSON.stringify(id)}: ${JSON.stringify(slug)},`).join("\n")}
};
`;

writeFileSync(new URL("../src/generation/catalog/openrouter-extra.ts", import.meta.url), file);
console.log(`wrote ${lines.length} extras`);
