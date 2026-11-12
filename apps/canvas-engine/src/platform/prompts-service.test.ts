import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const cache = new Map<string, any>();
  return {
    cache,
    sources: [] as any[],
    runPromptSource: vi.fn(),
  };
});

vi.mock("@/lib/localforage-storage", () => ({
  createScopedStorage: () => ({
    getItem: async (key: string) => mocks.cache.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      mocks.cache.set(key, value);
      return value;
    },
  }),
}));

vi.mock("@/stores/use-prompt-source-store", () => ({
  usePromptSourceStore: { getState: () => ({ sources: mocks.sources }) },
}));

vi.mock("@/services/api/prompt-source-runtime", () => ({
  runPromptSource: mocks.runPromptSource,
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

import {
  fetchPrompts,
  fetchSourcePrompts,
  refreshAllSources,
  refreshSource,
} from "@/services/api/prompts";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import type { RawPrompt } from "@/services/api/prompt-source-runtime";

const source = (overrides: Partial<PromptSource> = {}): PromptSource => ({
  id: "source-a",
  name: "Source A",
  url: "https://example.com/a.json",
  homepage: "https://example.com",
  enabled: true,
  builtIn: false,
  ...overrides,
});

const prompt = (id: string, title: string): RawPrompt => ({
  id,
  title,
  prompt: `${title} prompt`,
  description: "",
  coverUrl: "",
  referenceImageUrls: [],
  tags: ["one"],
  preview: "",
  createdAt: "",
  updatedAt: "",
});

beforeEach(() => {
  mocks.cache.clear();
  mocks.sources = [source()];
  mocks.runPromptSource.mockReset();
  mocks.runPromptSource.mockResolvedValue([prompt("p1", "First")]);
});

describe("prompt source service", () => {
  it("deduplicates configured source IDs before refreshing", async () => {
    mocks.sources = [source(), source({ name: "Duplicate" })];

    const result = await refreshAllSources();

    expect(result).toMatchObject({
      total: 1,
      successCount: 1,
      failureCount: 0,
    });
    expect(result.results).toHaveLength(1);
    expect(mocks.runPromptSource).toHaveBeenCalledOnce();
  });

  it("coalesces simultaneous refreshes for the same source revision", async () => {
    let resolve!: (items: RawPrompt[]) => void;
    mocks.runPromptSource.mockImplementation(
      () =>
        new Promise<RawPrompt[]>((finish) => {
          resolve = finish;
        }),
    );

    const first = refreshSource("source-a");
    const second = refreshSource("source-a");
    await vi.waitFor(() =>
      expect(mocks.runPromptSource).toHaveBeenCalledOnce(),
    );
    resolve([prompt("p1", "One")]);

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { success: true, count: 1 },
      { success: true, count: 1 },
    ]);
  });

  it("bounds refresh fan-out and keeps source result order", async () => {
    mocks.sources = Array.from({ length: 11 }, (_, index) =>
      source({ id: `source-${index}`, name: `Source ${index}` }),
    );
    let active = 0;
    let maxActive = 0;
    mocks.runPromptSource.mockImplementation(async (item: PromptSource) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return [prompt(item.id, item.name)];
    });

    const result = await refreshAllSources();

    expect(maxActive).toBeLessThanOrEqual(4);
    expect(result.results.map(({ sourceId }) => sourceId)).toEqual(
      mocks.sources.map(({ id }) => id),
    );
    expect(result).toMatchObject({
      total: 11,
      successCount: 11,
      failureCount: 0,
    });
  });

  it("keeps a newer URL result when an older request finishes later", async () => {
    const pending = new Map<string, (items: RawPrompt[]) => void>();
    mocks.runPromptSource.mockImplementation(
      (item: PromptSource) =>
        new Promise<RawPrompt[]>((resolve) => pending.set(item.url, resolve)),
    );

    const oldRequest = refreshSource("source-a");
    await vi.waitFor(() =>
      expect(pending.has("https://example.com/a.json")).toBe(true),
    );
    mocks.sources = [source({ url: "https://example.com/new.json" })];
    const newRequest = refreshSource("source-a");
    await vi.waitFor(() =>
      expect(pending.has("https://example.com/new.json")).toBe(true),
    );

    pending.get("https://example.com/new.json")!([prompt("new", "New URL")]);
    await newRequest;
    pending.get("https://example.com/a.json")!([prompt("old", "Old URL")]);
    await oldRequest;

    const cached = mocks.cache.get("prompt-source:source-a");
    expect(cached.signature).not.toBe("");
    expect(cached.items.map((item: RawPrompt) => item.title)).toEqual([
      "New URL",
    ]);
    await expect(fetchSourcePrompts("source-a")).resolves.toMatchObject([
      { title: "New URL", category: "Source A" },
    ]);
  });

  it("serves stale cached entries while revalidating a changed source", async () => {
    const previousSource = source();
    const nextSource = source({ url: "https://example.com/changed.json" });
    mocks.sources = [nextSource];
    mocks.cache.set("prompt-source:source-a", {
      sourceId: "source-a",
      items: [
        {
          ...prompt("cached", "Cached item"),
          sourceId: "source-a",
          category: previousSource.name,
          githubUrl: previousSource.homepage,
        },
      ],
      count: 1,
      fetchedAt: Date.now(),
      lastSuccessAt: new Date().toISOString(),
      lastError: "",
      signature: "old revision",
    });
    let finishRefresh!: (items: RawPrompt[]) => void;
    mocks.runPromptSource.mockImplementation(
      () =>
        new Promise<RawPrompt[]>((resolve) => {
          finishRefresh = resolve;
        }),
    );

    await expect(fetchSourcePrompts("source-a")).resolves.toMatchObject([
      { title: "Cached item", category: "Source A" },
    ]);
    await vi.waitFor(() =>
      expect(mocks.runPromptSource).toHaveBeenCalledOnce(),
    );
    finishRefresh([prompt("fresh", "Fresh item")]);
    await vi.waitFor(() =>
      expect(mocks.cache.get("prompt-source:source-a").items[0].title).toBe(
        "Fresh item",
      ),
    );
  });

  it("searches, filters by any selected tag and clamps pagination", async () => {
    mocks.runPromptSource.mockResolvedValue([
      { ...prompt("1", "Apple"), tags: ["red"] },
      { ...prompt("2", "Berry"), tags: ["blue"] },
      { ...prompt("3", "Citrus"), tags: ["red", "blue"] },
    ]);

    const result = await fetchPrompts({
      keyword: "prompt",
      tag: ["blue", "red"],
      page: -4,
      pageSize: 1.5,
    });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Apple");
    expect(result.tags).toEqual(["red", "blue"]);
    expect(result.categories).toEqual(["Source A"]);
  });
});
