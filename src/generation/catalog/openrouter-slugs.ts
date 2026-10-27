/** Studio model id → OpenRouter slug, taken from GET /videos/models and GET /images/models. */
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

/** Seedance 2+ honors video and audio inside input_references. */
const SEEDANCE = new Set([
  "seedance-2.5",
  "seedance-2.5-edit",
  "seedance-2.5-extend",
  "seedance-2",
  "seedance-2-fast",
  "seedance-2-mini",
]);

export function openRouterSlug(modelId: string): string {
  const slug = SLUGS[modelId];
  if (!slug) throw new Error(`No OpenRouter model for ${modelId}`);
  return slug;
}

export function seedanceReferences(modelId: string): boolean {
  return SEEDANCE.has(modelId);
}
