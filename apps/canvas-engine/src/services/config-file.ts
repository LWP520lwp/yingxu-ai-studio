import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { PRODUCT_FILE_ID, isSupportedFileId } from "@/lib/product-identity";
import {
  defaultConfig,
  defaultWebdavSyncConfig,
  platformConfig,
  useConfigStore,
  type AiConfig,
  type WebdavSyncConfig,
} from "@/stores/use-config-store";
import {
  isPromptSourceInterval,
  usePromptSourceStore,
  type PromptSourceSchedule,
} from "@/stores/use-prompt-source-store";
import {
  DEFAULT_PROMPT_SOURCES,
  type PromptSource,
} from "@/services/api/prompt-source-presets";

const CONFIG_FORMAT_VERSION = 1;
const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
const CONFIG_DOWNLOAD_NAME = "frameflow-preferences.json";

type AppConfigFile = {
  app: string;
  version: number;
  exportedAt: string;
  config: AiConfig;
  webdav: WebdavSyncConfig;
  promptSources: {
    sources: PromptSource[];
    schedule: PromptSourceSchedule;
  };
};

type PreferenceSnapshot = {
  models: AiConfig;
  synchronization: WebdavSyncConfig;
  library: { sources: PromptSource[]; schedule: PromptSourceSchedule };
};

/** Encode a detached, portable snapshot without reading stores or exporting secrets. */
export function serializeAppConfig(
  snapshot: PreferenceSnapshot,
  exportedAt = new Date().toISOString(),
): string {
  const file: AppConfigFile = {
    app: PRODUCT_FILE_ID,
    version: CONFIG_FORMAT_VERSION,
    exportedAt,
    config: redactConfigCredentials(platformConfig(snapshot.models)),
    webdav: { ...snapshot.synchronization, password: "" },
    promptSources: snapshot.library,
  };
  return JSON.stringify(file, null, 2);
}

export function exportAppConfig() {
  const settings = useConfigStore.getState();
  const library = usePromptSourceStore.getState();
  const json = serializeAppConfig({
    models: settings.config,
    synchronization: settings.webdav,
    library: { sources: library.sources, schedule: library.schedule },
  });
  saveAs(
    new Blob([json], { type: "application/json;charset=utf-8" }),
    CONFIG_DOWNLOAD_NAME,
  );
}

function redactConfigCredentials(config: AiConfig): AiConfig {
  return {
    ...config,
    apiKey: "",
    channels: config.channels.map((channel) => ({ ...channel, apiKey: "" })),
  };
}

export async function importAppConfig(file: File) {
  const parsed = await readConfigFile(file);
  const config = restorePreferences(parsed.config);
  const webdav = restoreWebdav(parsed.webdav);
  const sources = restorePromptSources(parsed.promptSources.sources);
  const schedule = restoreSchedule(parsed.promptSources.schedule);

  useConfigStore.setState({ config: platformConfig(config), webdav });
  usePromptSourceStore.setState({ sources, schedule });
}

async function readConfigFile(file: File): Promise<AppConfigFile> {
  try {
    if (file.size > MAX_CONFIG_BYTES) throw new Error("size");
    const value: unknown = JSON.parse(await file.text());
    if (!isRecord(value) || !isSupportedFileId(value.app))
      throw new Error("format");
    if (
      value.version !== CONFIG_FORMAT_VERSION ||
      !isRecord(value.config) ||
      !isRecord(value.webdav) ||
      !isRecord(value.promptSources) ||
      !Array.isArray(value.promptSources.sources)
    ) {
      throw new Error("shape");
    }
    return value as unknown as AppConfigFile;
  } catch {
    throw new Error(i18n.t("config.invalidFile"));
  }
}

function restorePreferences(source: Record<string, unknown>): AiConfig {
  const current = useConfigStore.getState().config;
  const next: AiConfig = {
    ...defaultConfig,
    apiKey: current.apiKey,
    channels: current.channels,
  };
  for (const key of Object.keys(defaultConfig) as Array<keyof AiConfig>) {
    if (key === "apiKey" || key === "channels") continue;
    const incoming = source[key];
    const current = defaultConfig[key];
    if (typeof current === "string" && typeof incoming === "string") {
      Object.assign(next, { [key]: incoming });
    } else if (typeof current === "boolean" && typeof incoming === "boolean") {
      Object.assign(next, { [key]: incoming });
    }
  }

  next.nodeRegenerateBehavior =
    next.nodeRegenerateBehavior === "overwrite" ? "overwrite" : "new-node";
  next.canvasImageCount = String(
    Math.max(1, Math.min(15, Math.floor(Number(next.canvasImageCount) || 1))),
  );
  next.proxyUrl = safeHttpUrl(next.proxyUrl) || defaultConfig.proxyUrl;
  return next;
}

function restoreWebdav(source: Record<string, unknown>): WebdavSyncConfig {
  const previous = useConfigStore.getState().webdav;
  const next: WebdavSyncConfig = { ...defaultWebdavSyncConfig, ...previous };
  for (const key of ["url", "username", "directory", "lastSyncedAt"] as const) {
    if (typeof source[key] === "string")
      next[key] = (source[key] as string).slice(0, 2048);
  }
  next.url = safeHttpUrl(next.url);

  // Passwords stay attached to their current destination and never arrive from an imported file.
  if (next.url !== previous.url || next.username !== previous.username)
    next.password = "";
  return next;
}

function restorePromptSources(values: unknown[]): PromptSource[] {
  const saved = values.filter(isRecord);
  const enabledById = new Map(
    saved
      .filter(
        (item) =>
          typeof item.id === "string" && typeof item.enabled === "boolean",
      )
      .map((item) => [item.id as string, item.enabled as boolean]),
  );
  const restored = DEFAULT_PROMPT_SOURCES.map((source) => ({
    ...source,
    enabled: enabledById.get(source.id) ?? source.enabled,
  }));
  const knownIds = new Set(restored.map((source) => source.id));

  for (const item of saved.slice(0, 100)) {
    const id = boundedText(item.id, 120);
    const url = safeHttpUrl(boundedText(item.url, 2048));
    const name = boundedText(item.name, 200);
    if (!id || !name || !url || knownIds.has(id)) continue;
    knownIds.add(id);
    restored.push({
      id,
      name,
      url,
      homepage: safeHttpUrl(boundedText(item.homepage, 2048)),
      enabled: item.enabled !== false,
      builtIn: false,
    });
  }
  return restored;
}

function restoreSchedule(value: unknown): PromptSourceSchedule {
  const saved = isRecord(value) ? value : {};
  const interval = saved.intervalMinutes;
  return {
    intervalMinutes:
      typeof interval === "number" && isPromptSourceInterval(interval)
        ? interval
        : 30,
    lastFetchedAt: boundedText(saved.lastFetchedAt, 40),
  };
}

function safeHttpUrl(value: string) {
  const candidate = value.trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function boundedText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
