import { speechModel } from "./defaults";
import type { ModelEntry, SettingField } from "./types";

const FORMAT_MP3_PCM: SettingField = {
  type: "enum",
  values: ["mp3", "pcm"],
  default: "mp3",
};

const VOXTRAL_VOICES = [
  "en_paul_neutral",
  "en_paul_happy",
  "en_paul_sad",
  "en_paul_excited",
  "en_paul_confident",
  "en_paul_cheerful",
  "en_paul_frustrated",
  "en_paul_angry",
] as const;

const ELEVEN_VOICES = [
  "george",
  "sarah",
  "adam",
  "alice",
  "bella",
  "bill",
  "brian",
  "callum",
] as const;

const KOKORO_VOICES = [
  "af_heart",
  "af_bella",
  "af_nicole",
  "af_aoede",
  "af_jessica",
  "am_adam",
  "am_michael",
  "bf_emma",
] as const;

const GROK_VOICES = ["eve", "ara", "rex", "sal", "leo"] as const;

function voiceEnum(values: readonly string[], fallback: string): SettingField {
  return { type: "enum", values, default: fallback };
}

function speedRange(min: number, max: number): SettingField {
  return { type: "range", min, max, default: 1, step: 0.05 };
}

export const voxtralMini = speechModel("voxtral-mini", "Voxtral Mini", {
  voice: voiceEnum(VOXTRAL_VOICES, "en_paul_neutral"),
  outputFormat: FORMAT_MP3_PCM,
});

export const elevenFlash = speechModel("eleven-flash", "Eleven Flash", {
  voice: voiceEnum(ELEVEN_VOICES, "george"),
  outputFormat: FORMAT_MP3_PCM,
  speed: speedRange(0.7, 1.2),
});

export const elevenMultilingual = speechModel("eleven-multilingual", "Eleven Multilingual", {
  voice: voiceEnum(ELEVEN_VOICES, "george"),
  outputFormat: FORMAT_MP3_PCM,
  speed: speedRange(0.7, 1.2),
});

export const kokoro = speechModel("kokoro", "Kokoro", {
  voice: voiceEnum(KOKORO_VOICES, "af_heart"),
  outputFormat: FORMAT_MP3_PCM,
  speed: speedRange(0.25, 4),
});

export const grokVoice = speechModel("grok-voice", "Grok Voice", {
  voice: voiceEnum(GROK_VOICES, "eve"),
  outputFormat: FORMAT_MP3_PCM,
});

/** OpenRouter-only TTS models. Kept out of the Higgsfield MODELS list. */
export const TTS_MODELS: readonly ModelEntry[] = [
  voxtralMini,
  elevenFlash,
  elevenMultilingual,
  kokoro,
  grokVoice,
];
