import { OPENROUTER_EXTRA_SLUGS } from "./openrouter-extra";

/** Studio model id → OpenRouter slug. One studio id owns each slug in the picker. */
const SLUGS: Record<string, string> = {
  "seedance-2.5": "bytedance/seedance-2.5",
  "seedance-2.5-edit": "bytedance/seedance-2.5",
  "seedance-2.5-extend": "bytedance/seedance-2.5",
  "seedance-2": "bytedance/seedance-2.0",
  "seedance-2-fast": "bytedance/seedance-2.0-fast",
  "seedance-2-mini": "bytedance/seedance-2.0-mini",
  "kling-3-std": "kwaivgi/kling-v3.0-std",
  "kling-3-pro": "kwaivgi/kling-v3.0-pro",
  "kling-o1": "kwaivgi/kling-video-o1",
  "wan-3": "alibaba/wan-3.0",
  "wan-3-prime": "alibaba/wan-3.0-prime",
  "wan-2.7": "alibaba/wan-2.7",
  "wan-2.6": "alibaba/wan-2.6",
  "minimax-h3": "minimax/hailuo-3",
  "minimax-hailuo-2.3": "minimax/hailuo-2.3",
  "happy-horse-1": "alibaba/happyhorse-1.0",
  "happy-horse-1.1": "alibaba/happyhorse-1.1",
  "grok-imagine-video-1.5": "x-ai/grok-imagine-video-1.5",
  "flux-3": "black-forest-labs/flux-3-video",
  "flux-2": "black-forest-labs/flux.2-pro",
  "grok-imagine-2": "x-ai/grok-imagine-image-2.0",
  "recraft-4.1": "recraft/recraft-v4.1",
  "qwen-image-3": "qwen/qwen-image-3",
};

/** Same OpenRouter slug as Seedance 2.5, so they stay Higgsfield-only in the picker. */
const OPENROUTER_DUPLICATES = new Set(["seedance-2.5-edit", "seedance-2.5-extend"]);

export function openRouterSlug(modelId: string): string {
  const slug = SLUGS[modelId] ?? OPENROUTER_EXTRA_SLUGS[modelId];
  if (!slug) throw new Error(`No OpenRouter model for ${modelId}`);
  return slug;
}

export function listedOnOpenRouter(modelId: string): boolean {
  if (OPENROUTER_DUPLICATES.has(modelId)) return false;
  return modelId in SLUGS || modelId in OPENROUTER_EXTRA_SLUGS;
}

const VIDEO_SLUGS = [
  "x-ai/grok-imagine-video-1.5-lite",
  "heygen/heygen-video-1",
  "black-forest-labs/flux-video-edit",
  "minimax/hailuo-3-max",
  "alibaba/wan-3.0-prime",
  "alibaba/wan-3.0",
  "heygen/avatar-iv",
  "black-forest-labs/flux-video-upscale",
  "bytedance/seedance-2.0-mini",
  "bytedance/seedance-2.5",
  "black-forest-labs/flux-3-video",
  "minimax/hailuo-3",
  "runway/aleph-2",
  "runway/gen-4.5",
  "x-ai/grok-imagine-video-1.5",
  "alibaba/happyhorse-1.1",
  "alibaba/happyhorse-1.0",
  "x-ai/grok-imagine-video",
  "kwaivgi/kling-v3.0-pro",
  "kwaivgi/kling-v3.0-std",
  "google/veo-3.1-fast",
  "google/veo-3.1-lite",
  "kwaivgi/kling-video-o1",
  "minimax/hailuo-2.3",
  "alibaba/wan-2.7",
  "bytedance/seedance-2.0-fast",
  "bytedance/seedance-2.0",
  "alibaba/wan-2.6",
  "bytedance/seedance-1-5-pro",
  "google/veo-3.1",
];

/** Claimed image slugs, inserted after the extra that precedes them in the models API. */
const IMAGE_AFTER: Record<string, string> = {
  "bytedance-seed/seedream-5-0-pro": "x-ai/grok-imagine-image-2.0",
  "qwen/qwen-image-3-pro": "qwen/qwen-image-3",
  "recraft/recraft-v4.1-pro": "recraft/recraft-v4.1",
  "black-forest-labs/flux.2-flex": "black-forest-labs/flux.2-pro",
};

export function openRouterSlugOrder(): string[] {
  const videos = new Set(VIDEO_SLUGS);
  const images = Object.values(OPENROUTER_EXTRA_SLUGS).filter((slug) => !videos.has(slug));
  const orderedImages: string[] = [];
  for (const slug of images) {
    orderedImages.push(slug);
    const insert = IMAGE_AFTER[slug];
    if (insert) orderedImages.push(insert);
  }
  return [...VIDEO_SLUGS, ...orderedImages];
}

export function seedanceReferences(modelId: string): boolean {
  const slug = SLUGS[modelId] ?? OPENROUTER_EXTRA_SLUGS[modelId] ?? "";
  return slug.startsWith("bytedance/seedance-2");
}
