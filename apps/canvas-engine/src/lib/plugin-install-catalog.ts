export type InstalledPlugin = {
  id: string;
  name: string;
  version: string;
  description?: string;
  url: string;
  source: string;
  enabled: boolean;
  local?: boolean;
  official?: boolean;
  installedAt: string;
};

export type PluginInstallInput = Omit<InstalledPlugin, "installedAt"> & {
  installedAt?: string;
};

export function restorePluginInstallations(value: unknown): InstalledPlugin[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, InstalledPlugin>();
  for (const record of value) {
    const plugin = parsePlugin(record);
    if (plugin) byId.set(plugin.id, plugin);
  }
  return [...byId.values()];
}

export function upsertPluginInstallation(
  catalog: InstalledPlugin[],
  input: PluginInstallInput,
  installedAt = new Date().toISOString(),
) {
  const previous = catalog.find((item) => item.id === input.id);
  const candidate = parsePlugin({
    ...input,
    installedAt: input.installedAt || previous?.installedAt || installedAt,
  });
  if (!candidate) return catalog;

  return previous
    ? catalog.map((item) => item.id === candidate.id ? candidate : item)
    : [candidate, ...catalog];
}

export function setPluginInstallationEnabled(
  catalog: InstalledPlugin[],
  id: string,
  enabled: boolean,
) {
  const current = catalog.find((item) => item.id === id);
  if (!current || current.enabled === enabled) return catalog;
  return catalog.map((item) => item.id === id ? { ...item, enabled } : item);
}

export function removePluginInstallation(catalog: InstalledPlugin[], id: string) {
  return catalog.some((item) => item.id === id)
    ? catalog.filter((item) => item.id !== id)
    : catalog;
}

function parsePlugin(value: unknown): InstalledPlugin | null {
  if (!isRecord(value)) return null;
  const id = clean(value.id, 180);
  const name = clean(value.name, 160);
  const version = clean(value.version, 80);
  if (!id || !name || !version || typeof value.url !== "string" || typeof value.source !== "string") {
    return null;
  }

  return {
    id,
    name,
    version,
    ...(typeof value.description === "string" ? { description: value.description.slice(0, 2000) } : {}),
    url: value.url.slice(0, 2048),
    source: value.source,
    enabled: value.enabled === true,
    local: value.local === true,
    official: value.official === true,
    installedAt: clean(value.installedAt, 40),
  };
}

function clean(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
