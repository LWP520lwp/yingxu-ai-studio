import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import { getPlatformInit, onPlatformInit, type PlatformInit } from "@/platform/rpc";

export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoMode: string;
    videoFramesReversed?: boolean;
    videoSkillId?: string;
    videoSkillVersion?: string;
    appliedSkillId?: string;
    appliedSkillVersion?: string;
    videoSkillReviewRequired?: boolean;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    proxyEnabled: boolean;
    proxyUrl: string;
    nodeRegenerateBehavior: "new-node" | "overwrite";
    autoFocusOnSelect: boolean;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "local-proxy" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

export type ChannelCredentialsImportResult = {
    status: "created" | "updated" | "missing-base-url" | "invalid-base-url";
    channelName?: string;
};

export const CONFIG_STORE_KEY = "frameflow:canvas:ai_config_store:v1";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
export const LOCAL_PROXY_PACKAGE = "@basketikun/canvas-proxy";
export const DEFAULT_LOCAL_PROXY_URL = "http://127.0.0.1:23210";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: "",
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "platform",
            name: "映序平台账号池",
            baseUrl: "",
            apiKey: "",
            apiFormat: "openai",
            models: [
                { name: "muse-image", capability: "image" },
                { name: "muse-video", capability: "video" },
            ],
        },
    ],
    model: "platform::muse-image",
    imageModel: "platform::muse-image",
    videoModel: "platform::muse-video",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "auto",
    videoWatermark: "auto",
    videoMode: "reference",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: ["platform::muse-image", "platform::muse-video"],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "1",
    proxyEnabled: false,
    proxyUrl: DEFAULT_LOCAL_PROXY_URL,
    nodeRegenerateBehavior: "new-node",
    autoFocusOnSelect: false,
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "yingxu-ai-studio",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    importChannelCredentials: (input: { baseUrl?: string | null; apiKey?: string | null }) => ChannelCredentialsImportResult;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["video", "sora", "veo", "kling", "wan", "hailuo"];

export function boolConfig(value: string, fallback: boolean) {
    return value ? value === "true" : fallback;
}
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    if (currentModel) {
        const configuredCapability = modelCapabilityOf(config, currentModel);
        // Keep unavailable selections visible so the readiness check blocks the
        // request. Only a known capability switch may choose another model.
        if (!configuredCapability || configuredCapability === capability) return currentModel;
    }
    // Newly uploaded media has no model of its own. Resolve its default from the
    // latest catalog, including when the caller still holds an older config.
    if (capability === "image" || capability === "video") return availablePlatformModel(defaultModel, capability);
    return defaultModel;
}

function availablePlatformModel(value: string, capability: "image" | "video") {
    const models = getPlatformInit()?.models[capability];
    const preferred = modelOptionName(value || "");
    const selected = models?.find((model) => model.id === preferred && model.available) || models?.find((model) => model.available);
    return selected ? encodeChannelModel("platform", selected.id) : "";
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    void config;
    void value;
    return "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const match = findChannelModel(config, model);
    if (!match || (match.model.capability !== "image" && match.model.capability !== "video")) return false;
    return Boolean(getPlatformInit()?.models[match.model.capability].some((item) => item.id === match.model.name && item.available));
}

/** Keep generation preferences local to the project; credentials and scripts live only on the host. */
export function platformConfig(config: AiConfig): AiConfig {
    const catalog = getPlatformInit()?.models;
    const entries: ChannelModel[] = catalog
        ? [...catalog.image.map((item) => ({ name: item.id, capability: "image" as const })), ...catalog.video.map((item) => ({ name: item.id, capability: "video" as const }))]
        : [];
    const imageModel = availablePlatformModel(config.imageModel, "image");
    const videoModel = availablePlatformModel(config.videoModel, "video");
    const current = modelOptionName(config.model || "");
    const matching = entries.find((entry) => entry.name === current);
    const matchingAvailable = catalog && [...catalog.image, ...catalog.video].some((entry) => entry.id === current && entry.available);
    return {
        ...config, baseUrl: "", apiKey: "", apiFormat: "openai", channelMode: "local",
        channels: [{ id: "platform", name: "映序平台账号池", baseUrl: "", apiKey: "", apiFormat: "openai", models: entries }],
        models: entries.map((entry) => encodeChannelModel("platform", entry.name)),
        model: matching && matchingAvailable ? encodeChannelModel("platform", matching.name) : imageModel || videoModel,
        imageModel, videoModel, textModel: "", audioModel: "",
        proxyEnabled: Boolean(config.proxyEnabled), proxyUrl: normalizeLocalProxyUrl(config.proxyUrl || DEFAULT_LOCAL_PROXY_URL),
    };
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set) => ({
            config: platformConfig(defaultConfig),
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: platformConfig({
                        ...state.config,
                        [key]: value,
                    }),
                })),
            importChannelCredentials: (input) => {
                void input;
                return { status: "invalid-base-url" };
            },
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            storage: createJSONStorage(() => localForageStorage),
            skipHydration: true,
            partialize: (state) => ({ config: platformConfig(state.config), webdav: { ...state.webdav, password: "" } }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav, password: "" },
                    config: platformConfig({
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(config.videoModel, channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
                        videoWatermark: config.videoWatermark || defaultConfig.videoWatermark,
                        videoMode: config.videoMode || defaultConfig.videoMode,
                        canvasImageCount: config.canvasImageCount || "1",
                        proxyEnabled: Boolean(config.proxyEnabled),
                        proxyUrl: config.proxyUrl || DEFAULT_LOCAL_PROXY_URL,
                        nodeRegenerateBehavior: config.nodeRegenerateBehavior === "overwrite" ? "overwrite" : "new-node",
                        autoFocusOnSelect: Boolean(config.autoFocusOnSelect),
                    }),
                };
            },
        },
    ),
);

export async function initializePlatformConfig(init: PlatformInit): Promise<void> {
    if (getPlatformInit()?.scopeId !== init.scopeId) throw new Error("生成配置初始化不属于当前画布");
    await useConfigStore.persist.rehydrate();
    if (getPlatformInit()?.scopeId !== init.scopeId) throw new Error("生成配置初始化不属于当前画布");
    useConfigStore.setState((state) => ({ config: platformConfig(state.config), isConfigOpen: false }));
}

// Account availability can change while the user is editing the canvas.
onPlatformInit(() => useConfigStore.setState((state) => ({ config: platformConfig(state.config) })));

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => platformConfig(config), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        result.push({ name, capability, script });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function upsertChannelCredentials(
    config: AiConfig,
    input: { baseUrl?: string | null; apiKey?: string | null },
): ChannelCredentialsImportResult & { config: AiConfig } {
    const rawBaseUrl = input.baseUrl?.trim() || "";
    if (!rawBaseUrl) return { status: "missing-base-url", config };
    if (!isHttpBaseUrl(rawBaseUrl)) return { status: "invalid-base-url", config };

    const baseUrl = normalizeImportedBaseUrl(rawBaseUrl);
    const apiKey = input.apiKey?.trim() || "";
    const matchingIndex = config.channels.findIndex((channel) => normalizedBaseUrlKey(channel.baseUrl) === normalizedBaseUrlKey(baseUrl));

    if (matchingIndex >= 0) {
        const existing = config.channels[matchingIndex];
        if (existing.baseUrl === baseUrl && (!apiKey || existing.apiKey === apiKey)) {
            return { status: "updated", channelName: existing.name, config };
        }
        const updated = { ...existing, baseUrl, ...(apiKey ? { apiKey } : {}) };
        const channels = config.channels.map((channel, index) => (index === matchingIndex ? updated : channel));
        return { status: "updated", channelName: existing.name, config: { ...config, channels } };
    }

    const channel = createModelChannel({
        name: importedChannelName(baseUrl),
        baseUrl,
        apiKey,
        apiFormat: "openai",
        models: [],
    });
    return { status: "created", channelName: channel.name, config: { ...config, channels: [...config.channels, channel] } };
}

function isHttpBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
        return false;
    }
}

function normalizedBaseUrlKey(baseUrl: string) {
    try {
        return stripTrailingApiVersion(normalizeImportedBaseUrl(baseUrl));
    } catch {
        return stripTrailingApiVersion(baseUrl.trim().replace(/\/+$/, ""));
    }
}

function normalizeImportedBaseUrl(baseUrl: string) {
    const url = new URL(baseUrl.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
}

function stripTrailingApiVersion(baseUrl: string) {
    return baseUrl.replace(/\/v1$/i, "");
}

function importedChannelName(baseUrl: string) {
    const hostname = new URL(baseUrl).hostname;
    return hostname.replace(/^(?:www|api)\./i, "") || i18n.t("config.channels.newName");
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    if (decoded.channelId === "platform") {
        const catalog = getPlatformInit()?.models;
        const item = [...(catalog?.image || []), ...(catalog?.video || [])].find((model) => model.id === decoded.model);
        if (item) return `${item.name || item.id}${item.available ? "" : " · 未就绪"}`;
    }
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: i18n.t("config.channels.defaultName"), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: "",
        apiKey: "",
        apiFormat: "openai" as const,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? i18n.t("config.channels.defaultName") : i18n.t("config.channels.indexedName", { index: index + 1 })),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: i18n.t("config.channels.defaultName"),
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return withLocalProxy(`${apiBaseUrl}${path}`);
}

export function normalizeLocalProxyUrl(value: string) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Prefix an outgoing request with the local forwarding proxy so the browser is not blocked by CORS. */
export function withLocalProxy(url: string) {
    const { proxyEnabled, proxyUrl } = useConfigStore.getState().config;
    if (!proxyEnabled || !/^https?:\/\//i.test(url)) return url;
    const base = normalizeLocalProxyUrl(proxyUrl);
    if (!base || url.startsWith(`${base}/`)) return url;
    return `${base}/${url}`;
}
