import type { Surface } from "../catalog/types";
import { useAudioMedia, useImageMedia, useVideoMedia } from "./media";
import { useAudioPrompt, useImagePrompt, useVideoPrompt } from "./prompt";

/** Prompt and media stores for a surface. Keeps plane/app ternaries in one place. */
export function storesFor(surface: Surface) {
  if (surface === "image") return { prompt: useImagePrompt, media: useImageMedia };
  if (surface === "audio") return { prompt: useAudioPrompt, media: useAudioMedia };
  return { prompt: useVideoPrompt, media: useVideoMedia };
}
