import { create } from "zustand";
import { persist } from "zustand/middleware";

import { getModel } from "../catalog";
import type { Surface } from "../catalog/types";
import { browserStorage } from "./browser-storage";

/** Results one press of Generate produces. Models that do not carry a count of
    their own are submitted once per result — every unit is a real platform
    request — so the ceiling is deliberately small. */
export const MAX_BATCH = 4;

type ActiveState = {
  surface: Surface;
  model: string;
  modelBySurface: Record<Surface, string>;
  batch: number;
  setModel: (id: string) => void;
  setBatch: (count: number) => void;
};

export const useActive = create<ActiveState>()(
  persist(
    (set) => ({
      surface: "video",
      model: "seedance-2.5",
      modelBySurface: { image: "flux-2", video: "seedance-2.5" },
      batch: 1,
      setModel: (id) => {
        const model = getModel(id);
        set((state) => {
          const modelBySurface = { ...state.modelBySurface, [model.surface]: model.id };
          if (
            state.model === model.id &&
            state.surface === model.surface &&
            state.modelBySurface[model.surface] === model.id
          ) {
            return state;
          }
          return { model: model.id, surface: model.surface, modelBySurface };
        });
      },
      setBatch: (count) =>
        set((state) => {
          const batch = Math.min(MAX_BATCH, Math.max(1, Math.round(count)));
          return state.batch === batch ? state : { batch };
        }),
    }),
    {
      name: "openhiggsfield.active.v2",
      storage: browserStorage(),
      partialize: (state) => ({
        surface: state.surface,
        model: state.model,
        modelBySurface: state.modelBySurface,
        batch: state.batch,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const remembered = state.modelBySurface?.[state.surface] || state.model;
        try {
          getModel(remembered);
          state.setModel(remembered);
        } catch {
          state.setModel(state.surface === "image" ? "flux-2" : "seedance-2.5");
        }
      },
    },
  ),
);
