import { describe, expect, it } from "vitest";
import {
  createDefaultConfig,
  defaultConfig,
  defaultWebdavSyncConfig,
} from "@/lib/config/defaults";
import {
  createChannelModelIndex,
  decodeChannelModel,
  encodeChannelModel,
  normalizeChannel,
  normalizeChannelModels,
  normalizeModelOptionValue,
} from "@/lib/config/channel-models";
import {
  migrateConfigSnapshot,
  serializeConfigSnapshot,
} from "@/lib/config/persistence";
import {
  applyPlatformCatalog,
  isCatalogModelReady,
  resolveCapabilityModel,
} from "@/lib/config/platform-models";
import { importChannelCredentials } from "@/lib/config/credentials";

const labels = {
  newName: "新渠道",
  defaultName: "默认渠道",
  indexedName: (index: number) => `渠道 ${index}`,
};
const channel = (id: string, models: unknown) =>
  normalizeChannel(
    { id, name: id, baseUrl: "https://example.com", models },
    { id, name: id },
  );
const catalog = {
  image: [
    { id: "saved-image", available: false },
    { id: "ready-image", available: true },
  ],
  video: [{ id: "ready-video", available: true }],
};

describe("configuration snapshot domain", () => {
  it("creates defaults without shared nested arrays or model records", () => {
    const edited = createDefaultConfig();
    edited.channels[0].models[0].name = "local-model";
    edited.models.push("extra");
    const next = createDefaultConfig();
    expect(next.channels[0].models[0].name).toBe("muse-image");
    expect(next.models).toEqual([
      "platform::muse-image",
      "platform::muse-video",
    ]);
    expect(defaultConfig.channels[0].models[0].name).toBe("muse-image");
  });
  it("migrates raw-name selections from legacy channels while retaining generation preferences", () => {
    const legacy = {
      config: {
        model: "flux",
        imageModel: "flux",
        videoModel: "c2::veo",
        textModel: "deepseek",
        channels: [
          { id: "c1", name: "图像", models: ["flux", "deepseek"] },
          { id: "c2", models: ["veo"] },
        ],
        quality: "high",
        size: "16:9",
        videoSeconds: "15",
        videoFramesReversed: true,
        videoSkillId: "combat",
      },
      webdav: {
        url: "https://dav.example",
        username: "u",
        password: "old-secret",
        directory: "old-dir",
      },
    };
    const result = migrateConfigSnapshot(legacy, labels);
    expect(result.config).toMatchObject({
      imageModel: "c1::flux",
      videoModel: "c2::veo",
      textModel: "c1::deepseek",
      quality: "high",
      size: "16:9",
      videoSeconds: "15",
      videoFramesReversed: true,
      videoSkillId: "combat",
    });
    expect(result.config.channels[1].name).toBe("渠道 2");
    expect(result.webdav).toMatchObject({
      url: "https://dav.example",
      username: "u",
      password: "",
      directory: "old-dir",
    });
    expect(legacy.webdav.password).toBe("old-secret");
  });

  it("builds a default channel for snapshots predating channel arrays", () => {
    const migrated = migrateConfigSnapshot(
      {
        config: {
          baseUrl: "https://old.example",
          apiKey: "legacy-key",
          apiFormat: "gemini",
          imageModel: "flux",
          videoModel: "veo",
          channels: null,
        },
      },
      labels,
    );
    expect(migrated.config.channels).toHaveLength(1);
    expect(migrated.config.channels[0]).toMatchObject({
      id: "default",
      name: "默认渠道",
      baseUrl: "https://old.example",
      apiKey: "legacy-key",
      apiFormat: "gemini",
    });
    expect(migrated.config.imageModel).toBe("default::flux");
  });

  it("recovers corrupt persisted field shapes instead of passing them into runtime lookups", () => {
    const migrated = migrateConfigSnapshot(
      {
        config: {
          model: null,
          imageModel: 32,
          quality: [],
          proxyUrl: {},
          proxyEnabled: "false",
          channels: [
            null,
            2,
            {
              id: {},
              name: null,
              models: [
                null,
                5,
                { name: 4 },
                " flux ",
                { name: "flux", capability: "text" },
                { name: "veo", capability: "bad" },
              ],
            },
          ],
          reasoningEffort: "invalid",
          nodeRegenerateBehavior: "invalid",
        },
        webdav: { url: null, directory: 2, password: "bad" },
      },
      labels,
    );
    expect(migrated.config).toMatchObject({
      quality: defaultConfig.quality,
      proxyEnabled: false,
      proxyUrl: defaultConfig.proxyUrl,
      reasoningEffort: "auto",
      nodeRegenerateBehavior: "new-node",
    });
    expect(migrated.config.channels[0].models).toEqual([
      { name: "flux", capability: "image", script: undefined },
      { name: "veo", capability: "video", script: undefined },
    ]);
    expect(migrated.webdav).toEqual(defaultWebdavSyncConfig);
  });

  it.each([null, false, 2, [], "bad"])(
    "accepts a missing or invalid snapshot: %j",
    (value) => {
      expect(migrateConfigSnapshot(value, labels).config.size).toBe(
        defaultConfig.size,
      );
    },
  );

  it("projects legacy credentials away and serializes WebDAV without its password", () => {
    const snapshot = migrateConfigSnapshot(
      {
        config: {
          apiKey: "legacy-key",
          baseUrl: "https://old.example",
          channels: [
            { id: "legacy", apiKey: "another-secret", models: ["flux"] },
          ],
        },
      },
      labels,
    );
    snapshot.webdav.password = "entered-now";
    const serialized = serializeConfigSnapshot(snapshot, (config) =>
      applyPlatformCatalog(config, catalog),
    );
    expect(serialized.webdav.password).toBe("");
    expect(snapshot.webdav.password).toBe("entered-now");
    expect(serialized.config.channels[0]).toMatchObject({
      id: "platform",
      apiKey: "",
      baseUrl: "",
    });
    expect(JSON.stringify(serialized)).not.toContain("legacy-key");
  });
});

describe("channel model indexing and host projection", () => {
  it("indexes qualified duplicates without allowing another channel to steal a selection", () => {
    const a = channel("a", [{ name: "shared", capability: "image" }]);
    const b = channel("b", [{ name: "shared", capability: "video" }]);
    const index = createChannelModelIndex([a, b]);
    expect(index.find("shared")?.channel).toBe(a);
    expect(index.find("b::shared")?.model.capability).toBe("video");
    expect(index.forCapability("image")).toEqual(["a::shared"]);
    expect(index.options).toEqual(["a::shared", "b::shared"]);
    expect(normalizeModelOptionValue("shared", [a, b])).toBe("a::shared");
    expect(normalizeModelOptionValue("missing::shared", [a, b])).toBe("");
    expect(normalizeModelOptionValue("unknown-name", [a, b])).toBe(
      "unknown-name",
    );
  });

  it("retains names containing the protocol separator and trims only the model boundary", () => {
    const value = encodeChannelModel("channel", " vendor::model ");
    expect(value).toBe("channel::vendor::model");
    expect(decodeChannelModel(value)).toEqual({
      channelId: "channel",
      model: "vendor::model",
    });
  });

  it("normalizes models once, retains first capability and drops empty scripts", () => {
    expect(
      normalizeChannelModels([
        " flux ",
        { name: "flux", capability: "video" },
        { name: "tts", capability: "audio", script: "  " },
        { name: "custom", capability: "text", script: " return 1 " },
      ]),
    ).toEqual([
      { name: "flux", capability: "image", script: undefined },
      { name: "tts", capability: "audio", script: undefined },
      { name: "custom", capability: "text", script: "return 1" },
    ]);
  });

  it("retains explicit unavailable node models while new nodes use a ready default", () => {
    const effective = applyPlatformCatalog(
      { ...defaultConfig, imageModel: "platform::saved-image" },
      catalog,
    );
    expect(effective.imageModel).toBe("platform::ready-image");
    expect(
      resolveCapabilityModel(
        effective,
        "platform::saved-image",
        "image",
        catalog,
      ),
    ).toBe("platform::saved-image");
    expect(
      isCatalogModelReady(effective, "platform::saved-image", catalog),
    ).toBe(false);
    expect(resolveCapabilityModel(effective, undefined, "image", catalog)).toBe(
      "platform::ready-image",
    );
    expect(applyPlatformCatalog(defaultConfig, undefined).models).toEqual([]);
  });

  it("updates an imported endpoint by normalized API root without discarding an existing key", () => {
    const existing = channel("old", []);
    existing.apiKey = "keep";
    existing.baseUrl = "https://api.example.com/v1";
    const config = { ...defaultConfig, channels: [existing] };
    const result = importChannelCredentials(
      config,
      { baseUrl: "https://api.example.com/" },
      (value) => normalizeChannel(value, { id: "new", name: "new" }),
      labels.newName,
    );
    expect(result.status).toBe("updated");
    expect(result.config.channels).toHaveLength(1);
    expect(result.config.channels[0].apiKey).toBe("keep");
    expect(config.channels[0].baseUrl).toBe("https://api.example.com/v1");
  });
});
