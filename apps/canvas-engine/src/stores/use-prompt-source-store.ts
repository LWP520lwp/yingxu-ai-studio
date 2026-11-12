import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createMigratingStorage } from "@/lib/localforage-storage";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";
import { createPromptSource, DEFAULT_PROMPT_SOURCES, type PromptSource } from "@/services/api/prompt-source-presets";
import {
  DEFAULT_PROMPT_SOURCE_SCHEDULE,
  normalizePromptSourceSchedule,
  removePromptSource,
  restorePromptSourceCatalog,
  setPromptSourceEnabled,
  upsertPromptSource,
  type PromptSourceSchedule,
} from "@/lib/prompt-source-catalog";

export { isPromptSourceInterval, PROMPT_SOURCE_INTERVALS } from "@/lib/prompt-source-catalog";
export type { PromptSourceSchedule } from "@/lib/prompt-source-catalog";

const STORE_KEY = "yingxu-atlas:prompt_source_store:v3";

type PromptSourceStore = {
  sources: PromptSource[];
  schedule: PromptSourceSchedule;
  addSource: () => PromptSource;
  saveSource: (source: PromptSource) => void;
  removeSource: (id: string) => void;
  toggleSource: (id: string, enabled: boolean) => void;
  updateSchedule: <K extends keyof PromptSourceSchedule>(key: K, value: PromptSourceSchedule[K]) => void;
};

export const usePromptSourceStore = create<PromptSourceStore>()(
  persist(
    (set) => ({
      sources: DEFAULT_PROMPT_SOURCES,
      schedule: { ...DEFAULT_PROMPT_SOURCE_SCHEDULE },
      addSource: () => createPromptSource(),
      saveSource: (source) => set((state) => ({ sources: upsertPromptSource(state.sources, source) })),
      removeSource: (id) => set((state) => ({ sources: removePromptSource(state.sources, id) })),
      toggleSource: (id, enabled) => set((state) => ({ sources: setPromptSourceEnabled(state.sources, id, enabled) })),
      updateSchedule: (key, value) => set((state) => ({
        schedule: normalizePromptSourceSchedule({ ...state.schedule, [key]: value }),
      })),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => createMigratingStorage(LEGACY_STORAGE_KEYS.promptSources)),
      partialize: ({ sources, schedule }) => ({ sources, schedule }),
      merge: (saved, current) => {
        const value = saved as Partial<PromptSourceStore> | null;
        return {
          ...current,
          sources: restorePromptSourceCatalog(value?.sources),
          schedule: normalizePromptSourceSchedule(value?.schedule),
        };
      },
    },
  ),
);
