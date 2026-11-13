import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: {
    channelMode: "remote",
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret-current",
    apiFormat: "openai",
    channels: [],
    model: "text-model",
    imageModel: "",
    videoModel: "",
    textModel: "text-model",
    audioModel: "",
    audioVoice: "",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "5",
    vquality: "standard",
    videoGenerateAudio: "true",
    videoWatermark: "true",
    videoMode: "text",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [],
    quality: "standard",
    size: "1024x1024",
    background: "auto",
    count: "1",
    canvasImageCount: "2",
    proxyEnabled: false,
    proxyUrl: "",
    nodeRegenerateBehavior: "new-node",
    autoFocusOnSelect: true,
  },
  webdav: {
    url: "https://sync.example.com/dav",
    username: "alice",
    password: "keep-this-password",
    directory: "/canvas",
    lastSyncedAt: "",
  },
  sources: [
    {
      id: "builtin",
      name: "Built-in",
      url: "https://example.com/prompts.json",
      homepage: "https://example.com",
      enabled: true,
      builtIn: true,
    },
  ],
  schedule: { intervalMinutes: 30, lastFetchedAt: "" },
  saveAs: vi.fn(),
}));

vi.mock("file-saver", () => ({ saveAs: state.saveAs }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/lib/product-identity", () => ({
  PRODUCT_FILE_ID: "yingxu-ai-studio",
  isSupportedFileId: (value: unknown) =>
    value === "yingxu-ai-studio" || value === "infinite-canvas",
}));
vi.mock("@/services/api/prompt-source-presets", () => ({
  DEFAULT_PROMPT_SOURCES: state.sources,
}));
vi.mock("@/stores/use-config-store", () => ({
  defaultConfig: state.config,
  defaultWebdavSyncConfig: {
    url: "",
    username: "",
    password: "",
    directory: "/",
    lastSyncedAt: "",
  },
  platformConfig: (config: unknown) => config,
  useConfigStore: {
    getState: () => ({ config: state.config, webdav: state.webdav }),
    setState: (patch: Record<string, unknown>) => Object.assign(state, patch),
  },
}));
vi.mock("@/stores/use-prompt-source-store", () => ({
  PROMPT_SOURCE_INTERVALS: [0, 30, 60, 360, 1440],
  isPromptSourceInterval: (value: number) =>
    [0, 30, 60, 360, 1440].includes(value),
  usePromptSourceStore: {
    getState: () => ({ sources: state.sources, schedule: state.schedule }),
    setState: (patch: Record<string, unknown>) => Object.assign(state, patch),
  },
}));

import {
  exportAppConfig,
  importAppConfig,
  serializeAppConfig,
} from "@/services/config-file";
import type { AiConfig } from "@/stores/use-config-store";

function configFile(value: unknown) {
  return new File([JSON.stringify(value)], "settings.json", {
    type: "application/json",
  });
}

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    app: "yingxu-ai-studio",
    version: 1,
    exportedAt: "2026-11-12T00:00:00.000Z",
    config: {
      ...state.config,
      canvasImageCount: "5",
      apiKey: "attacker-key",
      ...overrides,
    },
    webdav: {
      url: state.webdav.url,
      username: state.webdav.username,
      password: "from-file",
      directory: "/shared",
    },
    promptSources: {
      sources: [
        { ...state.sources[0], enabled: false },
        {
          id: "custom",
          name: "Custom",
          url: "https://example.com/custom.json",
          homepage: "javascript:alert(1)",
          enabled: true,
        },
      ],
      schedule: { intervalMinutes: 60, lastFetchedAt: "now" },
    },
  };
}

afterEach(() => {
  state.saveAs.mockReset();
  Object.assign(state, {
    config: { ...state.config, apiKey: "secret-current" },
    webdav: {
      url: "https://sync.example.com/dav",
      username: "alice",
      password: "keep-this-password",
      directory: "/canvas",
      lastSyncedAt: "",
    },
    sources: [
      {
        id: "builtin",
        name: "Built-in",
        url: "https://example.com/prompts.json",
        homepage: "https://example.com",
        enabled: true,
        builtIn: true,
      },
    ],
    schedule: { intervalMinutes: 30, lastFetchedAt: "" },
  });
});

describe("portable preference files", () => {
  it("encodes an explicit snapshot without mutating credentials or reading current stores", () => {
    const models = {
      ...state.config,
      apiKey: "source-key",
      channels: [{ id: "custom", apiKey: "channel-secret" }],
    } as unknown as AiConfig;
    const serialized = JSON.parse(
      serializeAppConfig(
        {
          models,
          synchronization: { ...state.webdav, password: "sync-secret" },
          library: {
            sources: [],
            schedule: { intervalMinutes: 0, lastFetchedAt: "" },
          },
        },
        "2026-11-13T00:00:00.000Z",
      ),
    );
    expect(serialized.config.apiKey).toBe("");
    expect(serialized.config.channels).toEqual([{ id: "custom", apiKey: "" }]);
    expect(serialized.webdav.password).toBe("");
    expect(serialized.exportedAt).toBe("2026-11-13T00:00:00.000Z");
    expect(models.apiKey).toBe("source-key");
    expect(models.channels[0].apiKey).toBe("channel-secret");
    expect(state.saveAs).not.toHaveBeenCalled();
  });
  it("exports settings without WebDAV credentials", () => {
    exportAppConfig();
    const [blob, name] = state.saveAs.mock.calls[0] as [Blob, string];
    expect(name).toBe("frameflow-preferences.json");
    return blob.text().then((text) => {
      const file = JSON.parse(text);
      expect(file.webdav.password).toBe("");
      expect(file.config.apiKey).toBe("");
    });
  });

  it("keeps provider secrets local and imports only validated preference data", async () => {
    await importAppConfig(configFile(validConfig()));
    expect(state.config).toMatchObject({
      apiKey: "secret-current",
      canvasImageCount: "5",
    });
    expect(state.webdav).toMatchObject({
      password: "keep-this-password",
      directory: "/shared",
    });
    expect(state.sources).toEqual([
      { ...state.sources[0], enabled: false },
      {
        id: "custom",
        name: "Custom",
        url: "https://example.com/custom.json",
        homepage: "",
        enabled: true,
        builtIn: false,
      },
    ]);
    expect(state.schedule).toEqual({
      intervalMinutes: 60,
      lastFetchedAt: "now",
    });
  });

  it("drops the saved password when an imported sync target changes", async () => {
    await importAppConfig(
      configFile(validConfig({ proxyUrl: "javascript:alert(1)" })),
    );
    const changedTarget = validConfig();
    changedTarget.webdav.url = "https://other.example.com/dav";
    await importAppConfig(configFile(changedTarget));
    expect(state.webdav.password).toBe("");
  });

  it("rejects unsupported or malformed files with one stable error", async () => {
    await expect(importAppConfig(configFile({ app: "other" }))).rejects.toThrow(
      "config.invalidFile",
    );
    await expect(
      importAppConfig(configFile({ ...validConfig(), version: 2 })),
    ).rejects.toThrow("config.invalidFile");
  });
});
