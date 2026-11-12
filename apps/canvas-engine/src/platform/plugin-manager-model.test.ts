import { describe, expect, it, vi } from "vitest";

vi.mock("@/constant/env", () => ({
  PLUGIN_REGISTRY_URL: "https://plugins.example/registry.json",
}));

import {
  groupInstalledPlugins,
  isPluginSourceUrl,
  officialVersionLabel,
  pluginErrorMessage,
} from "@/lib/canvas/plugin-manager-model";
import type { InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { OfficialPluginEntry } from "@/lib/canvas/plugin-registry";

function plugin(
  id: string,
  flags: Partial<Pick<InstalledPlugin, "local" | "official">> = {},
): InstalledPlugin {
  return {
    id,
    name: id,
    version: "1.0.0",
    url: `https://plugins.example/${id}.js`,
    source: "export default {}",
    enabled: false,
    installedAt: "2026-11-11T00:00:00.000Z",
    ...flags,
  };
}

const remote: OfficialPluginEntry = {
  id: "official",
  name: "Official",
  version: "2.0.0",
  url: "https://plugins.example/official.js",
};

describe("plugin manager view model", () => {
  it("groups persisted plugins without losing their records", () => {
    const local = plugin("local", { local: true });
    const official = plugin("official", { official: true });
    const thirdParty = plugin("third-party");

    const groups = groupInstalledPlugins([local, official, thirdParty]);

    expect(groups.byId.get("official")).toBe(official);
    expect(groups.local).toEqual([local]);
    expect(groups.thirdParty).toEqual([thirdParty]);
  });

  it("shows an installed-to-remote version only when an upgrade is available", () => {
    expect(officialVersionLabel(plugin("official"), remote)).toBe(
      "1.0.0 \u2192 2.0.0",
    );
    expect(
      officialVersionLabel(plugin("official", {}), {
        ...remote,
        version: "1.0.0",
      }),
    ).toBe("1.0.0");
    expect(officialVersionLabel(undefined, remote)).toBe("2.0.0");
  });

  it("accepts only explicit HTTP(S) source URLs", () => {
    expect(isPluginSourceUrl(" https://plugins.example/a.js ")).toBe(true);
    expect(isPluginSourceUrl("http://localhost:5173/plugin.js")).toBe(true);
    expect(isPluginSourceUrl("javascript:alert(1)")).toBe(false);
    expect(isPluginSourceUrl("/plugins/local.js")).toBe(false);
    expect(isPluginSourceUrl("not a URL")).toBe(false);
  });

  it("normalizes unknown action errors to readable text", () => {
    expect(pluginErrorMessage(new Error("failed"))).toBe("failed");
    expect(pluginErrorMessage("failed")).toBe("failed");
  });
});
