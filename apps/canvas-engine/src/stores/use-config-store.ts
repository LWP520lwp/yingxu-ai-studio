import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import {
  getPlatformInit,
  onPlatformInit,
  type PlatformInit,
} from "@/platform/rpc";
import {
  defaultConfig,
  defaultWebdavSyncConfig,
  CONFIG_STORE_KEY,
} from "@/lib/config/defaults";
import {
  createChannelModelIndex,
  decodeChannelModel,
  encodeChannelModel,
  guessCapability,
  modelOptionName,
  normalizeChannel,
  normalizeLocalProxyUrl,
} from "@/lib/config/channel-models";
import { importChannelCredentials } from "@/lib/config/credentials";
import {
  migrateConfigSnapshot,
  serializeConfigSnapshot,
} from "@/lib/config/persistence";
import {
  applyPlatformCatalog,
  catalogModelLabel,
  isCatalogModelReady,
  resolveCapabilityModel,
} from "@/lib/config/platform-models";
import type {
  AiConfig,
  ChannelCredentialsImportResult,
  ConfigTabKey,
  ModelCapability,
  ModelChannel,
  WebdavSyncConfig,
} from "@/lib/config/types";

// Public compatibility facade. Runtime state and platform effects stay here;
// model lookup and snapshot migration are independent pure domain modules.
export * from "@/lib/config/types";
export {
  defaultConfig,
  defaultWebdavSyncConfig,
  CONFIG_STORE_KEY,
  DEFAULT_LOCAL_PROXY_URL,
} from "@/lib/config/defaults";
export {
  decodeChannelModel,
  encodeChannelModel,
  guessCapability,
  isChannelModelValue,
  modelOptionName,
  modelOptionsFromChannels,
  normalizeChannelModels,
  normalizeModelOptionValue,
  normalizeLocalProxyUrl,
  defaultBaseUrlForApiFormat,
} from "@/lib/config/channel-models";

type ConfigStore = {
  config: AiConfig;
  webdav: WebdavSyncConfig;
  isConfigOpen: boolean;
  configTab: ConfigTabKey;
  shouldPromptContinue: boolean;
  updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
  importChannelCredentials: (input: {
    baseUrl?: string | null;
    apiKey?: string | null;
  }) => ChannelCredentialsImportResult;
  updateWebdavConfig: <K extends keyof WebdavSyncConfig>(
    key: K,
    value: WebdavSyncConfig[K],
  ) => void;
  isAiConfigReady: (config: AiConfig, model: string) => boolean;
  openConfigDialog: (
    shouldPromptContinue?: boolean,
    tab?: ConfigTabKey,
  ) => void;
  setConfigDialogOpen: (isOpen: boolean) => void;
  clearPromptContinue: () => void;
};

function channelLabels() {
  return {
    newName: i18n.t("config.channels.newName"),
    defaultName: i18n.t("config.channels.defaultName"),
    indexedName: (index: number) =>
      i18n.t("config.channels.indexedName", { index }),
  };
}

export function boolConfig(value: string, fallback: boolean) {
  return value ? value === "true" : fallback;
}

export function modelCapabilityOf(
  config: AiConfig,
  value: string,
): ModelCapability | undefined {
  return createChannelModelIndex(config.channels).find(value)?.model.capability;
}

export function modelMatchesCapability(
  config: AiConfig,
  value: string,
  capability?: ModelCapability,
) {
  return !capability || modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(
  config: AiConfig,
  currentModel: string | undefined,
  capability: ModelCapability,
) {
  return resolveCapabilityModel(
    config,
    currentModel,
    capability,
    getPlatformInit()?.models,
  );
}

export function selectableModelsByCapability(
  config: AiConfig,
  capability?: ModelCapability,
) {
  return capability
    ? createChannelModelIndex(config.channels).forCapability(capability)
    : config.models;
}

export function platformConfig(config: AiConfig): AiConfig {
  return applyPlatformCatalog(config, getPlatformInit()?.models);
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
          config: platformConfig({ ...state.config, [key]: value }),
        })),
      importChannelCredentials: (input) => {
        void input;
        return { status: "invalid-base-url" };
      },
      updateWebdavConfig: (key, value) =>
        set((state) => ({ webdav: { ...state.webdav, [key]: value } })),
      isAiConfigReady: (config, model) =>
        isCatalogModelReady(config, model, getPlatformInit()?.models),
      openConfigDialog: (
        shouldPromptContinue = false,
        configTab = "channels",
      ) => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
      setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
      clearPromptContinue: () => set({ shouldPromptContinue: false }),
    }),
    {
      name: CONFIG_STORE_KEY,
      storage: createJSONStorage(() => localForageStorage),
      skipHydration: true,
      partialize: (state) => serializeConfigSnapshot(state, platformConfig),
      merge: (persisted, current) => {
        const snapshot = migrateConfigSnapshot(persisted, channelLabels());
        return {
          ...current,
          ...snapshot,
          config: platformConfig(snapshot.config),
        };
      },
    },
  ),
);

export async function initializePlatformConfig(
  init: PlatformInit,
): Promise<void> {
  if (getPlatformInit()?.scopeId !== init.scopeId)
    throw new Error("生成配置初始化不属于当前画布");
  await useConfigStore.persist.rehydrate();
  if (getPlatformInit()?.scopeId !== init.scopeId)
    throw new Error("生成配置初始化不属于当前画布");
  useConfigStore.setState((state) => ({
    config: platformConfig(state.config),
    isConfigOpen: false,
  }));
}

onPlatformInit(() =>
  useConfigStore.setState((state) => ({
    config: platformConfig(state.config),
  })),
);

export function useEffectiveConfig() {
  const config = useConfigStore((state) => state.config);
  return useMemo(() => platformConfig(config), [config]);
}

export function createModelChannel(
  channel?: Partial<ModelChannel>,
): ModelChannel {
  return normalizeChannel(channel, {
    id: nanoid(),
    name: channelLabels().newName,
  });
}

export function upsertChannelCredentials(
  config: AiConfig,
  input: { baseUrl?: string | null; apiKey?: string | null },
): ChannelCredentialsImportResult & { config: AiConfig } {
  return importChannelCredentials(
    config,
    input,
    createModelChannel,
    channelLabels().newName,
  );
}

export function modelOptionLabel(config: AiConfig, value: string) {
  const selection = decodeChannelModel(value);
  if (!selection) return value;
  if (selection.channelId === "platform") {
    const label = catalogModelLabel(getPlatformInit()?.models, selection.model);
    if (label) return label;
  }
  const channel = createChannelModelIndex(config.channels).channel(
    selection.channelId,
  );
  return channel ? `${selection.model}（${channel.name}）` : selection.model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
  const index = createChannelModelIndex(config.channels);
  const selection = decodeChannelModel(value);
  return (
    (selection
      ? index.channel(selection.channelId)
      : index.find(value)?.channel) ||
    config.channels[0] ||
    createModelChannel({
      id: "default",
      name: channelLabels().defaultName,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      apiFormat: config.apiFormat,
      models: config.models
        .map(modelOptionName)
        .map((name) => ({ name, capability: guessCapability(name) })),
    })
  );
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

export function buildApiUrl(baseUrl: string, path: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return withLocalProxy(
    `${base.toLowerCase().endsWith("/v1") ? base : `${base}/v1`}${path}`,
  );
}

/** The forwarding proxy remains a local preference; provider credentials live on the host. */
export function withLocalProxy(url: string) {
  const { proxyEnabled, proxyUrl } = useConfigStore.getState().config;
  if (!proxyEnabled || !/^https?:\/\//i.test(url)) return url;
  const base = normalizeLocalProxyUrl(proxyUrl);
  return !base || url.startsWith(`${base}/`) ? url : `${base}/${url}`;
}
