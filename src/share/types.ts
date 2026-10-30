export type ShareKind = "image" | "video" | "timeline";
export type ClipKind = "image" | "video";

/** Public labels only. Never cost, prompt, or account. */
export type ShareFact = {
  model: string;
  ratio: string;
  size: string;
};
