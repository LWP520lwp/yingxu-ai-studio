import { PLUGIN_REGISTRY_URL } from "@/constant/env";
import i18n from "@/i18n";
import { resolvePluginSourceUrl } from "./url";

export type OfficialPluginEntry = Readonly<{
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  url: string;
}>;

type RegistryCandidate = {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  icon?: unknown;
  entry?: unknown;
  url?: unknown;
};

function registryError(status: string | number) {
  return new Error(i18n.t("canvas.pluginErrors.registryFailed", { status }));
}

function textOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export async function fetchOfficialPluginCatalog(
  registryUrl = PLUGIN_REGISTRY_URL,
  signal?: AbortSignal,
): Promise<OfficialPluginEntry[]> {
  const endpoint = resolvePluginSourceUrl(registryUrl);
  if (!endpoint) throw registryError("invalid URL");

  const response = await fetch(endpoint.href, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw registryError(response.status);

  let raw: unknown;
  try {
    raw = (await response.json() as { plugins?: unknown } | null)?.plugins;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw registryError("invalid JSON");
  }
  if (!Array.isArray(raw)) return [];

  const entries = new Map<string, OfficialPluginEntry>();
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as RegistryCandidate;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || entries.has(id)) continue;

    const rawUrl = typeof item.url === "string" && item.url.trim()
      ? item.url.trim()
      : typeof item.entry === "string" ? item.entry.trim() : "";
    const url = rawUrl ? resolvePluginSourceUrl(rawUrl, endpoint.href) : null;
    if (!url) continue;

    entries.set(id, {
      id,
      name: textOr(item.name, id),
      version: textOr(item.version, "0.0.0"),
      description: typeof item.description === "string" ? item.description : undefined,
      icon: typeof item.icon === "string" ? item.icon : undefined,
      url: url.href,
    });
  }
  return [...entries.values()];
}

function versionParts(value: string): number[] | null {
  const match = /^\s*v?(\d+(?:\.\d+){0,2})(?:[-+].*)?\s*$/i.exec(value);
  return match ? match[1].split(".").map(Number) : null;
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function hasPluginUpgrade(installedVersion: string, catalogVersion: string): boolean {
  return compareVersions(catalogVersion, installedVersion) > 0;
}
