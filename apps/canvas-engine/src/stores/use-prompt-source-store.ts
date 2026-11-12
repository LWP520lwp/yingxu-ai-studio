import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createMigratingStorage } from "@/lib/localforage-storage";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";
import {
  createPromptSource,
  DEFAULT_PROMPT_SOURCES,
  type PromptSource,
} from "@/services/api/prompt-source-presets";

export type PromptSourceSchedule = {
  intervalMinutes: number;
  lastFetchedAt: string;
};

export const PROMPT_SOURCE_INTERVALS = [0, 30, 60, 360, 1440] as const;
export const DEFAULT_PROMPT_SOURCE_SCHEDULE: Readonly<PromptSourceSchedule> = {
  intervalMinutes: 30,
  lastFetchedAt: "",
};

const STORE_KEY = "yingxu-atlas:prompt_source_store:v3";

type PromptSourceStore = {
  sources: PromptSource[];
  schedule: PromptSourceSchedule;
  addSource: () => PromptSource;
  saveSource: (source: PromptSource) => void;
  removeSource: (id: string) => void;
  toggleSource: (id: string, enabled: boolean) => void;
  updateSchedule: <K extends keyof PromptSourceSchedule>(
    key: K,
    value: PromptSourceSchedule[K],
  ) => void;
};

export function isPromptSourceInterval(
  value: number,
): value is (typeof PROMPT_SOURCE_INTERVALS)[number] {
  return PROMPT_SOURCE_INTERVALS.includes(value as (typeof PROMPT_SOURCE_INTERVALS)[number]);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSchedule(value: unknown): PromptSourceSchedule {
  const input = record(value) ? value : {};
  const interval = input.intervalMinutes;
  return {
    intervalMinutes:
      typeof interval === "number" && isPromptSourceInterval(interval)
        ? interval
        : DEFAULT_PROMPT_SOURCE_SCHEDULE.intervalMinutes,
    lastFetchedAt: text(input.lastFetchedAt).slice(0, 40),
  };
}

function parseSource(value: unknown): PromptSource | null {
  if (!record(value)) return null;
  const id = text(value.id);
  if (!id) return null;
  return createPromptSource({
    id,
    name: text(value.name),
    url: text(value.url),
    homepage: text(value.homepage),
    enabled: value.enabled === true,
    builtIn: value.builtIn === true,
  });
}

function restoreSources(value: unknown): PromptSource[] {
  const saved = Array.isArray(value) ? value : [];
  const byId = new Map<string, PromptSource>();
  for (const item of saved) {
    const source = parseSource(item);
    if (source) byId.set(source.id, source);
  }
  const builtIns = DEFAULT_PROMPT_SOURCES.map((source) => ({
    ...source,
    enabled: byId.get(source.id)?.enabled ?? source.enabled,
  }));
  const builtInIds = new Set(builtIns.map((source) => source.id));
  const custom = [...byId.values()].filter(
    (source) => !source.builtIn && !builtInIds.has(source.id),
  );
  return [...builtIns, ...custom];
}

function saveInto(sources: PromptSource[], input: PromptSource): PromptSource[] {
  const current = sources.find((source) => source.id === input.id);
  if (current?.builtIn) return sources;
  const next = createPromptSource({ ...input, builtIn: false });
  return current
    ? sources.map((source) => (source.id === next.id ? next : source))
    : [...sources, next];
}

function removeFrom(sources: PromptSource[], id: string): PromptSource[] {
  const target = sources.find((source) => source.id === id);
  return !target || target.builtIn
    ? sources
    : sources.filter((source) => source.id !== id);
}

function setEnabled(sources: PromptSource[], id: string, enabled: boolean): PromptSource[] {
  const target = sources.find((source) => source.id === id);
  return !target || target.enabled === enabled
    ? sources
    : sources.map((source) =>
        source.id === id ? { ...source, enabled } : source,
      );
}

export const usePromptSourceStore = create<PromptSourceStore>()(
  persist(
    (set) => ({
      sources: DEFAULT_PROMPT_SOURCES,
      schedule: { ...DEFAULT_PROMPT_SOURCE_SCHEDULE },
      addSource: () => createPromptSource(),
      saveSource: (source) =>
        set((state) => ({ sources: saveInto(state.sources, source) })),
      removeSource: (id) =>
        set((state) => ({ sources: removeFrom(state.sources, id) })),
      toggleSource: (id, enabled) =>
        set((state) => ({ sources: setEnabled(state.sources, id, enabled) })),
      updateSchedule: (key, value) =>
        set((state) => ({
          schedule: normalizeSchedule({ ...state.schedule, [key]: value }),
        })),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() =>
        createMigratingStorage(LEGACY_STORAGE_KEYS.promptSources),
      ),
      partialize: ({ sources, schedule }) => ({ sources, schedule }),
      merge: (saved, current) => {
        const snapshot = saved as Partial<PromptSourceStore> | null;
        return {
          ...current,
          sources: restoreSources(snapshot?.sources),
          schedule: normalizeSchedule(snapshot?.schedule),
        };
      },
    },
  ),
);
