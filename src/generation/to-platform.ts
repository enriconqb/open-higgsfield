import { getModel } from "./catalog";
import { openRouterSlug, seedanceReferences } from "./catalog/openrouter-slugs";
import type { GenerationPlane } from "./catalog/types";

export type MappedRequest = {
  surface: "image" | "video";
  body: Record<string, unknown>;
};

export function toPlatform(plane: GenerationPlane): MappedRequest {
  const model = getModel(plane.model);
  const slug = openRouterSlug(model.id);
  if (model.surface === "image") return { surface: "image", body: mapImage(plane, slug) };
  return { surface: "video", body: mapVideo(plane, slug, seedanceReferences(model.id)) };
}

function urls(plane: GenerationPlane, role: "start" | "end" | "reference" | "video" | "audio") {
  return (plane.media[role] ?? []).map((item) => item.url).filter(Boolean);
}

function mapVideo(plane: GenerationPlane, slug: string, seedance: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: slug,
    prompt: plane.prompt.text,
    ...commonVideo(plane),
  };
  const references = seedance ? seedanceReferencesOf(plane) : imageReferences(urls(plane, "reference"));
  const frames = frameImages(urls(plane, "start")[0], urls(plane, "end")[0]);

  if (seedance) {
    if (references.length) body.input_references = references;
    else if (frames.length) body.frame_images = frames;
    return body;
  }

  if (frames.length) body.frame_images = frames;
  else if (references.length) body.input_references = references;
  return body;
}

function seedanceReferencesOf(plane: GenerationPlane) {
  return [
    ...imageReferences(urls(plane, "reference")),
    ...urls(plane, "video").map((url) => ({ type: "video_url", video_url: { url } })),
    ...urls(plane, "audio").map((url) => ({ type: "audio_url", audio_url: { url } })),
  ];
}

function imageReferences(images: string[]) {
  return images.map((url) => ({ type: "image_url", image_url: { url } }));
}

function frameImages(start?: string, end?: string) {
  const frames = [];
  if (start) {
    frames.push({
      type: "image_url",
      image_url: { url: start },
      frame_type: "first_frame",
    });
  }
  if (end) {
    frames.push({
      type: "image_url",
      image_url: { url: end },
      frame_type: "last_frame",
    });
  }
  return frames;
}

function commonVideo(plane: GenerationPlane): Record<string, unknown> {
  const settings = plane.settings;
  const audio = settings.generateAudio ?? settings.sound;
  return {
    ...(typeof settings.aspectRatio === "string" ? { aspect_ratio: settings.aspectRatio } : {}),
    ...(typeof settings.resolution === "string" ? { resolution: settings.resolution } : {}),
    ...(typeof settings.duration === "number" ? { duration: settings.duration } : {}),
    ...(typeof audio === "boolean" ? { generate_audio: audio } : {}),
    ...(typeof settings.seed === "number" ? { seed: settings.seed } : {}),
  };
}

function mapImage(plane: GenerationPlane, slug: string): Record<string, unknown> {
  const settings = plane.settings;
  const refs = imageReferences(urls(plane, "reference"));
  const batch = Number(settings.batchSize);
  const format = settings.outputFormat;
  return {
    model: slug,
    prompt: plane.prompt.text,
    ...(typeof settings.aspectRatio === "string" ? { aspect_ratio: settings.aspectRatio } : {}),
    ...(typeof settings.resolution === "string" ? { resolution: settings.resolution } : {}),
    ...(Number.isFinite(batch) && batch > 0 ? { n: Math.min(10, batch) } : {}),
    ...(typeof format === "string" && ["png", "jpeg", "webp", "svg"].includes(format)
      ? { output_format: format }
      : {}),
    ...(refs.length ? { input_references: refs } : {}),
  };
}
