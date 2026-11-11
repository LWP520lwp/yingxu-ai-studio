import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { isSupportedFileId, PRODUCT_FILE_ID } from "@/lib/product-identity";
import { defaultConfig, defaultWebdavSyncConfig, platformConfig, useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { PROMPT_SOURCE_INTERVALS, usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import { DEFAULT_PROMPT_SOURCES, type PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: string;
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const data: AppConfigFile = { app: PRODUCT_FILE_ID, version: 1, exportedAt: new Date().toISOString(), config: platformConfig(config), webdav: { ...webdav, password: "" }, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "frameflow-preferences.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        if (file.size > 2 * 1024 * 1024) throw new Error();
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (!isSupportedFileId(data?.app) || data.version !== 1 || !isRecord(data.config) || !isRecord(data.webdav) || !isRecord(data.promptSources) || !Array.isArray(data.promptSources.sources)) throw new Error(i18n.t("config.invalidFile"));
    // Older exports contain local channel keys and scripts. Import preferences only;
    // server credentials are deliberately managed through the channel API instead.
    const imported = { ...defaultConfig };
    for (const key of Object.keys(defaultConfig) as Array<keyof AiConfig>) {
        const value = data.config[key];
        if ((typeof defaultConfig[key] === "string" && typeof value === "string") || (typeof defaultConfig[key] === "boolean" && typeof value === "boolean")) Object.assign(imported, { [key]: value });
    }
    imported.nodeRegenerateBehavior = imported.nodeRegenerateBehavior === "overwrite" ? "overwrite" : "new-node";
    imported.canvasImageCount = String(Math.max(1, Math.min(15, Math.floor(Number(imported.canvasImageCount) || 1))));
    imported.proxyUrl = safeUrl(imported.proxyUrl) || defaultConfig.proxyUrl;
    const webdav: WebdavSyncConfig = { ...defaultWebdavSyncConfig, ...useConfigStore.getState().webdav };
    for (const key of ["url", "username", "directory", "lastSyncedAt"] as const) if (typeof data.webdav[key] === "string") webdav[key] = data.webdav[key];
    webdav.url = safeUrl(webdav.url);
    // A previously entered password belongs to the existing destination only.
    if (webdav.url !== useConfigStore.getState().webdav.url || webdav.username !== useConfigStore.getState().webdav.username) webdav.password = "";
    const sources = validatePromptSources(data.promptSources.sources);
    const schedule: Record<string, unknown> = isRecord(data.promptSources.schedule) ? data.promptSources.schedule : {};
    const intervalMinutes = typeof schedule.intervalMinutes === "number" && PROMPT_SOURCE_INTERVALS.includes(schedule.intervalMinutes) ? schedule.intervalMinutes : 30;
    useConfigStore.setState({ config: platformConfig(imported), webdav });
    usePromptSourceStore.setState({ sources, schedule: { intervalMinutes, lastFetchedAt: typeof schedule.lastFetchedAt === "string" ? schedule.lastFetchedAt : "" } });
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

function safeUrl(value: string) {
    if (!value.trim()) return "";
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.toString().replace(/\/$/, "") : ""; }
    catch { return ""; }
}

function validatePromptSources(values: unknown[]): PromptSource[] {
    const enabledById = new Map(values.filter(isRecord).map((source) => [source.id, source.enabled]));
    const sources = DEFAULT_PROMPT_SOURCES.map((source) => ({ ...source, enabled: typeof enabledById.get(source.id) === "boolean" ? enabledById.get(source.id) as boolean : source.enabled }));
    const seen = new Set(sources.map((source) => source.id));
    for (const value of values.slice(0, 100)) {
        if (!isRecord(value) || typeof value.id !== "string" || !value.id || seen.has(value.id) || typeof value.name !== "string" || typeof value.url !== "string") continue;
        const url = safeUrl(value.url);
        if (!url) continue;
        seen.add(value.id);
        sources.push({ id: value.id.slice(0, 120), name: value.name.slice(0, 200), url, homepage: typeof value.homepage === "string" ? safeUrl(value.homepage) : "", enabled: value.enabled !== false, builtIn: false });
    }
    return sources;
}
