import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { PromptMention } from "../mentions";
import { browserStorage } from "./browser-storage";

type PromptState = {
  text: string;
  mentions: PromptMention[];
  setText: (text: string) => void;
  /** Replace the words and remember one mention. The mention stays until forgotten. */
  commit: (text: string, mention?: PromptMention) => void;
  forget: (id: string) => void;
  /** Replace the sentence and every mention, as reuse does. */
  restore: (text: string, mentions: PromptMention[]) => void;
};

function createPromptStore(name: string) {
  return create<PromptState>()(
    persist(
      (set) => ({
        text: "",
        mentions: [],
        setText: (text) => set((state) => (state.text === text ? state : { text })),
        commit: (text, mention) =>
          set((state) => {
            const mentions = mention
              ? [...state.mentions.filter((item) => item.id !== mention.id), mention]
              : state.mentions;
            if (state.text === text && sameMentions(state.mentions, mentions)) return state;
            return { text, mentions };
          }),
        forget: (id) => set((state) => ({ mentions: state.mentions.filter((item) => item.id !== id) })),
        restore: (text, mentions) => set({ text, mentions }),
      }),
      {
        name,
        storage: browserStorage(),
        partialize: (state) => ({
          text: state.text,
          mentions: state.mentions.filter((mention) => !mention.url.startsWith("blob:")),
        }),
      },
    ),
  );
}

function sameMentions(left: PromptMention[], right: PromptMention[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((mention, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      mention.id === other.id &&
      mention.kind === other.kind &&
      mention.label === other.label &&
      mention.url === other.url
    );
  });
}

export const useImagePrompt = createPromptStore("openhiggsfield.imagePrompt.v1");
export const useVideoPrompt = createPromptStore("openhiggsfield.videoPrompt.v1");
export const useAudioPrompt = createPromptStore("openhiggsfield.audioPrompt.v1");
