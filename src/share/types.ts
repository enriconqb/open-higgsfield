export type ShareKind = "image" | "video" | "timeline" | "audio";
export type ClipKind = "image" | "video" | "audio";

/** Public labels only. Never cost, prompt, or account. */
export type ShareFact = {
  model: string;
  ratio: string;
  size: string;
};
