import { PLUGIN_REGISTRY_URL } from "@/constant/env";
import i18n from "@/i18n";

export type OfficialPluginEntry = {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  url: string;
};

type RegistryRecord = {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  icon?: unknown;
  entry?: unknown;
  url?: unknown;
};

function httpUrl(input: string, base?: string) {
  try {
    const parsed = base ? new URL(input, base) : new URL(input);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    )
      return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export async function fetchOfficialPlugins(
  registryUrl: string = PLUGIN_REGISTRY_URL,
  signal?: AbortSignal,
): Promise<OfficialPluginEntry[]> {
  const endpoint = httpUrl(registryUrl);
  if (!endpoint) throw registryError("invalid URL");

  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw registryError(response.status);

  let records: unknown;
  try {
    records = ((await response.json()) as { plugins?: unknown })?.plugins;
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? error;
    }
    throw registryError("invalid JSON");
  }
  if (!Array.isArray(records)) return [];

  const unique = new Map<string, OfficialPluginEntry>();
  for (const value of records) {
    if (!value || typeof value !== "object") continue;
    const item = value as RegistryRecord;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || unique.has(id)) continue;

    const candidate =
      typeof item.url === "string" && item.url.trim()
        ? item.url.trim()
        : typeof item.entry === "string"
          ? item.entry.trim()
          : "";
    const url = candidate ? httpUrl(candidate, endpoint) : null;
    if (!url) continue;

    unique.set(id, {
      id,
      name: nonEmpty(item.name, id),
      version: nonEmpty(item.version, "0.0.0"),
      description:
        typeof item.description === "string" ? item.description : undefined,
      icon: typeof item.icon === "string" ? item.icon : undefined,
      url,
    });
  }
  return [...unique.values()];
}

function nonEmpty(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function registryError(status: string | number) {
  return new Error(i18n.t("canvas.pluginErrors.registryFailed", { status }));
}

function numericRelease(value: string) {
  const match = /^\s*v?(\d+(?:\.\d+){0,2})(?:[-+].*)?\s*$/i.exec(value);
  if (!match) return null;
  return match[1].split(".").map((part) => Number(part));
}

function compareRelease(left: string, right: string) {
  const a = numericRelease(left);
  const b = numericRelease(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function hasUpgrade(installedVersion: string, remoteVersion: string) {
  return compareRelease(remoteVersion, installedVersion) > 0;
}
