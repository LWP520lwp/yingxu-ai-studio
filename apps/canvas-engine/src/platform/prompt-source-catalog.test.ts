import { describe, expect, it } from "vitest";

import { DEFAULT_PROMPT_SOURCES } from "@/services/api/prompt-source-presets";
import {
  normalizePromptSourceSchedule,
  removePromptSource,
  restorePromptSourceCatalog,
  setPromptSourceEnabled,
  upsertPromptSource,
} from "@/lib/prompt-source-catalog";

describe("prompt source catalog", () => {
  it("restores built-ins while keeping only unique user-owned additions", () => {
    const builtIn = DEFAULT_PROMPT_SOURCES[0];
    const result = restorePromptSourceCatalog([
      { ...builtIn, enabled: false, name: "modified built-in" },
      { id: "custom", name: "Custom", url: "https://example.com/feed.json", enabled: true },
      { id: "custom", name: "Duplicate", url: "https://example.com/other.json", enabled: false },
      { id: "", name: "Invalid" },
    ]);

    expect(result[0]).toMatchObject({ id: builtIn.id, name: builtIn.name, enabled: false, builtIn: true });
    expect(result.filter((source) => source.id === "custom")).toHaveLength(1);
    expect(result.find((source) => source.id === "custom")?.url).toBe("https://example.com/other.json");
  });

  it("keeps built-in records immutable and makes custom-source updates idempotent", () => {
    const builtIn = DEFAULT_PROMPT_SOURCES[0];
    const custom = { id: "custom", name: "Before", url: "https://example.com/a.json", homepage: "", enabled: true, builtIn: false };
    const catalog = [builtIn, custom];

    expect(upsertPromptSource(catalog, { ...builtIn, name: "changed" })).toBe(catalog);
    expect(removePromptSource(catalog, builtIn.id)).toBe(catalog);
    expect(setPromptSourceEnabled(catalog, custom.id, true)).toBe(catalog);
    expect(upsertPromptSource(catalog, { ...custom, name: "After" })).toMatchObject([
      { id: builtIn.id, name: builtIn.name },
      { id: "custom", name: "After" },
    ]);
    expect(removePromptSource(catalog, custom.id)).toEqual([builtIn]);
  });

  it("normalizes invalid refresh intervals and bounds stored timestamps", () => {
    expect(normalizePromptSourceSchedule({ intervalMinutes: -1, lastFetchedAt: "x".repeat(100) })).toEqual({
      intervalMinutes: 30,
      lastFetchedAt: "x".repeat(40),
    });
    expect(normalizePromptSourceSchedule({ intervalMinutes: 360 }).intervalMinutes).toBe(360);
  });
});
