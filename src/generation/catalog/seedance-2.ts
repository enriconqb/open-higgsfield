import type { ModelEntry } from "./types";
import { SEEDANCE_ASPECT } from "./tokens";

const seedanceRoles = { start: 1, end: 1, reference: 9, video: 3, audio: 3 } as const;

const seedanceResolutions = ["480p", "720p", "1080p", "4k"] as const;

const seedanceSettings = {
  aspectRatio: { type: "enum", values: SEEDANCE_ASPECT, default: "16:9" },
  duration: { type: "range", min: 4, max: 15, default: 5 },
  generateAudio: { type: "boolean", default: true },
} as const satisfies ModelEntry["settings"];

/** Edit and extend keep the source clip's frame, so they have no aspect ratio. */
const seedanceEditSettings = {
  duration: { type: "range", min: 4, max: 15, default: 5 },
  generateAudio: { type: "boolean", default: true },
  resolution: { type: "enum", values: seedanceResolutions, default: "720p" },
} as const satisfies ModelEntry["settings"];

const seedanceEditRoles = { video: 1, reference: 9, audio: 3 } as const;

export const seedance2: ModelEntry = {
  id: "seedance-2",
  surface: "video",
  label: "Seedance 2.0",
  roles: seedanceRoles,
  settings: {
    ...seedanceSettings,
    resolution: { type: "enum", values: seedanceResolutions, default: "720p" },
  },
};

export const seedance2Edit: ModelEntry = {
  id: "seedance-2-edit",
  surface: "video",
  label: "Seedance 2.0 Edit",
  roles: seedanceEditRoles,
  settings: seedanceEditSettings,
};

export const seedance2Extend: ModelEntry = {
  id: "seedance-2-extend",
  surface: "video",
  label: "Seedance 2.0 Extend",
  roles: seedanceEditRoles,
  settings: seedanceEditSettings,
};

export const seedance2Fast: ModelEntry = {
  id: "seedance-2-fast",
  surface: "video",
  label: "Seedance 2.0 Fast",
  roles: seedanceRoles,
  settings: {
    ...seedanceSettings,
    resolution: { type: "enum", values: seedanceResolutions, default: "720p" },
  },
};

export const seedance2FastEdit: ModelEntry = {
  id: "seedance-2-fast-edit",
  surface: "video",
  label: "Seedance 2.0 Fast Edit",
  roles: seedanceEditRoles,
  settings: seedanceEditSettings,
};

export const seedance2FastExtend: ModelEntry = {
  id: "seedance-2-fast-extend",
  surface: "video",
  label: "Seedance 2.0 Fast Extend",
  roles: seedanceEditRoles,
  settings: seedanceEditSettings,
};

export const seedance2Mini: ModelEntry = {
  id: "seedance-2-mini",
  surface: "video",
  label: "Seedance 2.0 Mini",
  roles: seedanceRoles,
  settings: {
    ...seedanceSettings,
    resolution: { type: "enum", values: ["480p", "720p"], default: "720p" },
  },
};
