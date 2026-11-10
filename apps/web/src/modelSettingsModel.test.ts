import { describe, expect, it } from "vitest";
import { configuredCandidates, mergeDiscoveredModels, selectedChannelModels, type DiscoveredModel } from "./modelSettingsModel";

describe("channel discovery confirmation", () => {
  it("keeps unknown models visible but never enables unknown or merely suggested models", () => {
    const discovered: DiscoveredModel[] = [
      { name: "private-research-model", capability: "unknown", source: "unknown", requiresConfirmation: true },
      { name: "gpt-4.1", capability: "text", source: "name-hint", requiresConfirmation: true },
    ];
    const candidates = mergeDiscoveredModels([], discovered);
    expect(candidates).toHaveLength(2);
    expect(selectedChannelModels(candidates)).toEqual([]);
    expect(() => selectedChannelModels([{ ...candidates[0], selected: true }])).toThrow("确认模型能力");
  });
  it("preserves an explicit role through repeat discovery and serializes only confirmed fields", () => {
    const current = configuredCandidates([{ name: "private-model", capability: "vision" }]);
    const merged = mergeDiscoveredModels(current, [{ name: "private-model", capability: "text", source: "name-hint", requiresConfirmation: true }]);
    expect(selectedChannelModels(merged)).toEqual([{ name: "private-model", capability: "vision" }]);
    expect(selectedChannelModels([{ ...merged[0], selected: false }])).toEqual([]);
  });
});
