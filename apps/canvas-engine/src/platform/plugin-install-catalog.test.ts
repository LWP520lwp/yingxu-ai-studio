import { describe, expect, it } from "vitest";

import {
  removePluginInstallation,
  restorePluginInstallations,
  setPluginInstallationEnabled,
  upsertPluginInstallation,
  type InstalledPlugin,
} from "@/lib/plugin-install-catalog";

const plugin: InstalledPlugin = {
  id: "motion-tools",
  name: "Motion tools",
  version: "1.0.0",
  url: "https://example.com/plugin.js",
  source: "export default {}",
  enabled: true,
  local: false,
  official: true,
  installedAt: "2026-11-01T00:00:00.000Z",
};

describe("plugin installation catalog", () => {
  it("restores valid entries, deduplicates by id, and ignores malformed values", () => {
    const restored = restorePluginInstallations([
      plugin,
      { ...plugin, name: "Updated", enabled: false },
      { id: "bad", name: "Missing fields" },
    ]);
    expect(restored).toEqual([{ ...plugin, name: "Updated", enabled: false }]);
  });

  it("keeps the original installation date across updates", () => {
    const updated = upsertPluginInstallation([plugin], { ...plugin, version: "2.0.0", installedAt: "" });
    expect(updated[0]).toMatchObject({ version: "2.0.0", installedAt: plugin.installedAt });
  });

  it("returns the existing catalog for no-op toggles and unknown removals", () => {
    const catalog = [plugin];
    expect(setPluginInstallationEnabled(catalog, plugin.id, true)).toBe(catalog);
    expect(removePluginInstallation(catalog, "missing")).toBe(catalog);
    expect(removePluginInstallation(catalog, plugin.id)).toEqual([]);
  });
});
