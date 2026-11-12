import { createScopedStorage } from "@/lib/localforage-storage";
import { mapConcurrent } from "@/lib/async-pool";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import type {
  Prompt,
  PromptListResponse,
  PromptSourceRefreshResult,
  PromptSourceRefreshSummary,
  PromptSourceStatus,
  RawPrompt,
} from "@/types/prompts";
import i18n from "@/i18n";
import type { PromptSource } from "./prompt-source-presets";
import { runPromptSource } from "./prompt-source-runtime";

export type {
  Prompt,
  PromptListResponse,
  PromptSourceRefreshResult,
  PromptSourceRefreshSummary,
  PromptSourceStatus,
} from "@/types/prompts";
export type { RawPrompt } from "@/types/prompts";

export const ALL_PROMPTS_OPTION = "all";

type SourceCache = PromptSourceStatus & {
  items: Prompt[];
  fetchedAt: number;
  signature: string;
};

const CACHE_MAX_AGE = 60 * 60 * 1000;
const SOURCE_FETCH_CONCURRENCY = 4;
const promptCache = createScopedStorage("prompt_cache");
const requests = new Map<string, Promise<PromptSourceRefreshResult>>();
const activeSignature = new Map<string, string>();

function uniqueEnabledSources(): PromptSource[] {
  const ids = new Set<string>();
  return usePromptSourceStore.getState().sources.filter((source) => {
    if (!source.enabled || ids.has(source.id)) return false;
    ids.add(source.id);
    return true;
  });
}

function storageKey(sourceId: string) {
  return `prompt-source:${sourceId}`;
}

function signatureOf(source: PromptSource) {
  const input = `${source.name}\n${source.url}\n${source.homepage}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${input.length}:${hash >>> 0}`;
}

function requestKey(source: PromptSource) {
  return `${source.id}\0${signatureOf(source)}`;
}

function bindSource(
  source: PromptSource,
  values: readonly RawPrompt[],
): Prompt[] {
  return values.map((item) => ({
    ...item,
    description: item.description || "",
    referenceImageUrls: Array.isArray(item.referenceImageUrls)
      ? item.referenceImageUrls
      : [],
    sourceId: source.id,
    category: source.name,
    githubUrl: item.sourceUrl || source.homepage,
  }));
}

async function readCache(sourceId: string): Promise<SourceCache | null> {
  const value = await promptCache.getItem<SourceCache>(storageKey(sourceId));
  return value && Array.isArray(value.items) ? value : null;
}

function statusFromCache(
  source: PromptSource,
  cache: SourceCache | null,
  error = "",
) {
  return {
    sourceId: source.id,
    sourceName: source.name,
    count: cache?.items.length ?? 0,
    lastSuccessAt: cache?.lastSuccessAt ?? "",
    lastError: error,
    success: !error,
  } satisfies PromptSourceRefreshResult;
}

async function refreshOne(
  source: PromptSource,
  signature: string,
): Promise<PromptSourceRefreshResult> {
  const oldCache = await readCache(source.id);
  try {
    const items = bindSource(source, await runPromptSource(source));
    const lastSuccessAt = new Date().toISOString();
    const next: SourceCache = {
      sourceId: source.id,
      items,
      count: items.length,
      fetchedAt: Date.now(),
      lastSuccessAt,
      lastError: "",
      signature,
    };

    // A slower request for a previous URL must never overwrite its replacement.
    if (activeSignature.get(source.id) === signature) {
      await promptCache.setItem(storageKey(source.id), next);
    }
    return {
      sourceId: source.id,
      sourceName: source.name,
      count: items.length,
      lastSuccessAt,
      lastError: "",
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (activeSignature.get(source.id) !== signature) {
      return statusFromCache(source, await readCache(source.id), message);
    }

    const retained: SourceCache = {
      sourceId: source.id,
      items: oldCache?.items ?? [],
      count: oldCache?.items.length ?? 0,
      fetchedAt: oldCache?.fetchedAt ?? 0,
      lastSuccessAt: oldCache?.lastSuccessAt ?? "",
      lastError: message,
      signature: oldCache?.signature ?? signature,
    };
    await promptCache.setItem(storageKey(source.id), retained);
    return statusFromCache(source, retained, message);
  }
}

function getOrRefresh(
  source: PromptSource,
): Promise<PromptSourceRefreshResult> {
  const key = requestKey(source);
  const running = requests.get(key);
  if (running) return running;

  const signature = signatureOf(source);
  activeSignature.set(source.id, signature);
  let job: Promise<PromptSourceRefreshResult>;
  job = refreshOne(source, signature).finally(() => {
    if (requests.get(key) === job) requests.delete(key);
  });
  requests.set(key, job);
  return job;
}

async function loadSource(source: PromptSource): Promise<Prompt[]> {
  const cached = await readCache(source.id);
  const signature = signatureOf(source);
  if (cached) {
    const isStale =
      cached.signature !== signature ||
      Date.now() - cached.fetchedAt >= CACHE_MAX_AGE;
    if (isStale) void getOrRefresh(source).catch(() => undefined);
    return bindSource(source, cached.items);
  }

  const refreshed = await getOrRefresh(source);
  if (!refreshed.success) throw new Error(refreshed.lastError);
  const current = await readCache(source.id);
  if (!current || current.signature !== signature) return [];
  return bindSource(source, current.items);
}

export async function fetchPrompts({
  keyword = "",
  tag = [],
  category = ALL_PROMPTS_OPTION,
  page = 1,
  pageSize = 20,
}: {
  keyword?: string;
  tag?: string[];
  category?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<PromptListResponse> {
  const sources = uniqueEnabledSources();
  const settled = await mapConcurrent(
    sources,
    SOURCE_FETCH_CONCURRENCY,
    async (source) => {
      try {
        return await loadSource(source);
      } catch {
        return [];
      }
    },
  );
  const all = settled.flat();
  const normalizedKeyword = keyword.trim().toLocaleLowerCase();
  const tagsBeforeFilter = selectPrompts(all, {
    keyword: normalizedKeyword,
    category,
    tags: [],
  });
  const matching = selectPrompts(all, {
    keyword: normalizedKeyword,
    category,
    tags: [...new Set(tag)],
  });
  const safePage = Math.max(1, Math.floor(Number.isFinite(page) ? page : 1));
  const safeSize = Math.max(
    1,
    Math.min(100, Math.floor(Number.isFinite(pageSize) ? pageSize : 20)),
  );
  const categories = [...new Set(sources.map((source) => source.name))];

  return {
    items: matching.slice((safePage - 1) * safeSize, safePage * safeSize),
    tags: [
      ...new Set(tagsBeforeFilter.flatMap((item) => item.tags).filter(Boolean)),
    ],
    categories,
    total: matching.length,
  };
}

export async function fetchSourcePrompts(sourceId: string): Promise<Prompt[]> {
  const source = usePromptSourceStore
    .getState()
    .sources.find((item) => item.id === sourceId);
  if (!source) throw new Error(i18n.t("prompts.sourceMissing"));
  return loadSource(source);
}

export async function refreshSource(
  sourceId: string,
): Promise<PromptSourceRefreshResult> {
  const source = usePromptSourceStore
    .getState()
    .sources.find((item) => item.id === sourceId);
  if (!source) throw new Error(i18n.t("prompts.sourceMissing"));
  const result = await getOrRefresh(source);
  if (!result.success) throw new Error(result.lastError);
  return result;
}

export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {
  return summarize(
    await mapConcurrent(
      uniqueEnabledSources(),
      SOURCE_FETCH_CONCURRENCY,
      getOrRefresh,
    ),
  );
}

export async function refreshDueSources(
  maxAgeMs: number,
): Promise<PromptSourceRefreshSummary> {
  const sources = uniqueEnabledSources();
  const due = await Promise.all(
    sources.map(async (source) => {
      const cache = await readCache(source.id);
      const lastSuccess = cache?.lastSuccessAt
        ? new Date(cache.lastSuccessAt).getTime()
        : 0;
      return !lastSuccess ||
        Boolean(cache?.lastError) ||
        Date.now() - lastSuccess >= maxAgeMs ||
        cache?.signature !== signatureOf(source)
        ? source
        : null;
    }),
  );
  return summarize(
    await mapConcurrent(
      due.filter(isSource),
      SOURCE_FETCH_CONCURRENCY,
      getOrRefresh,
    ),
  );
}

export async function fetchPromptSourceStatuses(): Promise<
  Record<string, PromptSourceStatus>
> {
  const sources = usePromptSourceStore.getState().sources;
  const entries = await Promise.all(
    sources.map(async (source) => {
      const cache = await readCache(source.id);
      return [
        source.id,
        {
          sourceId: source.id,
          count: cache?.items.length ?? 0,
          lastSuccessAt: cache?.lastSuccessAt ?? "",
          lastError: cache?.lastError ?? "",
        } satisfies PromptSourceStatus,
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function isSource(source: PromptSource | null): source is PromptSource {
  return source !== null;
}

function summarize(
  results: PromptSourceRefreshResult[],
): PromptSourceRefreshSummary {
  return {
    results,
    total: results.reduce((sum, result) => sum + result.count, 0),
    successCount: results.filter((result) => result.success).length,
    failureCount: results.filter((result) => !result.success).length,
  };
}

function selectPrompts(
  items: Prompt[],
  filters: { keyword: string; category: string; tags: string[] },
) {
  return items.filter((item) => {
    if (
      filters.category &&
      filters.category !== ALL_PROMPTS_OPTION &&
      filters.category !== "all" &&
      item.category !== filters.category
    ) {
      return false;
    }
    if (
      filters.tags.length &&
      !filters.tags.some((tag) => item.tags.includes(tag))
    ) {
      return false;
    }
    if (!filters.keyword) return true;
    const searchable = [
      item.title,
      item.prompt,
      item.description,
      item.category,
      ...item.tags,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(filters.keyword);
  });
}

export function formatPromptDate(value: string, locale?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
