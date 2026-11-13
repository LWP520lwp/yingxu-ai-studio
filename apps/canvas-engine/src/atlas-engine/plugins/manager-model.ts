import { hasPluginUpgrade, type OfficialPluginEntry } from "./official-registry";
import type { InstalledPlugin } from "@/stores/canvas/use-plugin-store";

export type PluginCollections = {
  byId: Map<string, InstalledPlugin>;
  local: InstalledPlugin[];
  thirdParty: InstalledPlugin[];
};

export function groupInstalledPlugins(plugins: readonly InstalledPlugin[]): PluginCollections {
  const byId = new Map<string, InstalledPlugin>();
  const local: InstalledPlugin[] = [];
  const thirdParty: InstalledPlugin[] = [];

  for (const plugin of plugins) {
    byId.set(plugin.id, plugin);
    if (plugin.local) local.push(plugin);
    else if (!plugin.official) thirdParty.push(plugin);
  }

  return { byId, local, thirdParty };
}

export function officialVersionLabel(installed: InstalledPlugin | undefined, remote: OfficialPluginEntry): string {
  return installed && hasPluginUpgrade(installed.version, remote.version)
    ? `${installed.version} \u2192 ${remote.version}`
    : remote.version;
}

export function isPluginSourceUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function pluginErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
