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

export function normalizePromptSourceSchedule(value: unknown): PromptSourceSchedule {
  const saved = isRecord(value) ? value : {};
  const interval = saved.intervalMinutes;
  return {
    intervalMinutes:
      typeof interval === "number" && isPromptSourceInterval(interval)
        ? interval
        : DEFAULT_PROMPT_SOURCE_SCHEDULE.intervalMinutes,
    lastFetchedAt: typeof saved.lastFetchedAt === "string" ? saved.lastFetchedAt.slice(0, 40) : "",
  };
}

export function restorePromptSourceCatalog(value: unknown): PromptSource[] {
  const saved = Array.isArray(value) ? value : [];
  const byId = new Map<string, PromptSource>();
  for (const value of saved) {
    const source = parseSavedSource(value);
    if (source) byId.set(source.id, source);
  }

  const defaults = DEFAULT_PROMPT_SOURCES.map((source) => ({
    ...source,
    enabled: byId.get(source.id)?.enabled ?? source.enabled,
  }));
  const builtInIds = new Set(defaults.map((source) => source.id));
  const additions = [...byId.values()].filter((source) => !source.builtIn && !builtInIds.has(source.id));
  return [...defaults, ...additions];
}

export function upsertPromptSource(sources: PromptSource[], input: PromptSource) {
  const existing = sources.find((source) => source.id === input.id);
  if (existing?.builtIn) return sources;

  const next = createPromptSource({ ...input, builtIn: false });
  return existing
    ? sources.map((source) => source.id === next.id ? next : source)
    : [...sources, next];
}

export function removePromptSource(sources: PromptSource[], id: string) {
  const target = sources.find((source) => source.id === id);
  if (!target || target.builtIn) return sources;
  return sources.filter((source) => source.id !== id);
}

export function setPromptSourceEnabled(sources: PromptSource[], id: string, enabled: boolean) {
  const target = sources.find((source) => source.id === id);
  if (!target || target.enabled === enabled) return sources;
  return sources.map((source) => source.id === id ? { ...source, enabled } : source);
}

export function isPromptSourceInterval(value: number): value is (typeof PROMPT_SOURCE_INTERVALS)[number] {
  return (PROMPT_SOURCE_INTERVALS as readonly number[]).includes(value);
}

function parseSavedSource(value: unknown): PromptSource | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  return createPromptSource({
    id: value.id.trim(),
    name: typeof value.name === "string" ? value.name : "",
    url: typeof value.url === "string" ? value.url : "",
    homepage: typeof value.homepage === "string" ? value.homepage : "",
    enabled: value.enabled === true,
    builtIn: value.builtIn === true,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
