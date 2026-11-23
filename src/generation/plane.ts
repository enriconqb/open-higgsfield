import { getModel } from "./catalog";
import type { GenerationPlane, MediaItem } from "./catalog/types";
import { resolvePromptMentions } from "./mentions";
import { useActive } from "./stores/active";
import { storesFor } from "./stores/for-surface";
import { useSettings } from "./stores/settings";

export function assemblePlane(): GenerationPlane {
  const { model: modelId, surface } = useActive.getState();
  const model = getModel(modelId);
  const { prompt: promptStore, media: mediaStore } = storesFor(surface);
  const prompt = promptStore.getState();
  const items = mediaStore.getState().items;
  const media: GenerationPlane["media"] = {};
  for (const item of items) pushMedia(media, model.roles, item);
  const resolved = resolvePromptMentions({
    text: prompt.text,
    catalog: prompt.mentions ?? [],
    roles: model.roles,
    existing: items,
  });
  for (const item of resolved.additions) pushMedia(media, model.roles, item);
  return {
    model: model.id,
    prompt: { text: resolved.text },
    media,
    settings: useSettings.getState().byModel[model.id] ?? {},
  };
}

function pushMedia(
  media: GenerationPlane["media"],
  roles: Partial<Record<MediaItem["role"], number>>,
  item: MediaItem,
) {
  const max = roles[item.role];
  if (!max) return;
  const list = media[item.role] ?? [];
  if (list.length >= max) return;
  if (list.some((held) => held.url === item.url)) return;
  list.push(item);
  media[item.role] = list;
}
