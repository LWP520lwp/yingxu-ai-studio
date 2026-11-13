import {
  defaultConfig,
  createDefaultConfig,
  defaultWebdavSyncConfig,
  DEFAULT_LOCAL_PROXY_URL,
} from "./defaults";
import {
  modelOptionName,
  modelOptionsFromChannels,
  normalizeApiFormat,
  normalizeChannel,
  normalizeChannelModels,
  normalizeModelOptionValue,
  recordValue,
  textValue,
  type ChannelLabels,
} from "./channel-models";
import type { AiConfig, ModelChannel, WebdavSyncConfig } from "./types";

export type ConfigSnapshot = { config: AiConfig; webdav: WebdavSyncConfig };

const OPTIONAL_STRINGS = [
  "videoSkillId",
  "videoSkillVersion",
  "appliedSkillId",
  "appliedSkillVersion",
] as const;
const OPTIONAL_BOOLEANS = [
  "videoFramesReversed",
  "videoSkillReviewRequired",
] as const;
const REQUIRED_PREFERENCES = [
  "audioVoice",
  "audioFormat",
  "audioSpeed",
  "videoSeconds",
  "vquality",
  "videoGenerateAudio",
  "videoWatermark",
  "videoMode",
  "canvasImageCount",
  "proxyUrl",
] as const;

function readPreferences(input: Record<string, unknown>): AiConfig {
  const result = createDefaultConfig();
  // Stored versions used this same field vocabulary. Copy only compatible
  // scalar fields so a corrupt or stale import cannot change runtime shapes.
  for (const key of Object.keys(defaultConfig) as Array<keyof AiConfig>) {
    const value = input[key];
    const expected = typeof defaultConfig[key];
    if (
      (expected === "string" || expected === "boolean") &&
      typeof value === expected
    )
      Object.assign(result, { [key]: value });
  }
  for (const key of OPTIONAL_STRINGS)
    if (typeof input[key] === "string") result[key] = input[key];
  for (const key of OPTIONAL_BOOLEANS)
    if (typeof input[key] === "boolean") result[key] = input[key];
  for (const key of REQUIRED_PREFERENCES) result[key] ||= defaultConfig[key];
  result.apiFormat = normalizeApiFormat(input.apiFormat);
  result.channelMode = "local";
  result.reasoningEffort = ["auto", "low", "medium", "high", "xhigh"].includes(
    result.reasoningEffort,
  )
    ? result.reasoningEffort
    : "auto";
  result.nodeRegenerateBehavior =
    result.nodeRegenerateBehavior === "overwrite" ? "overwrite" : "new-node";
  result.proxyUrl ||= DEFAULT_LOCAL_PROXY_URL;
  return result;
}

function readChannels(
  input: Record<string, unknown>,
  config: AiConfig,
  labels: ChannelLabels,
): ModelChannel[] {
  if (Array.isArray(input.channels) && input.channels.length) {
    return input.channels
      .filter(
        (value) =>
          value !== null && typeof value === "object" && !Array.isArray(value),
      )
      .map((value, index) =>
        normalizeChannel(value, {
          id: index ? `channel-${index + 1}` : "default",
          name: index ? labels.indexedName(index + 1) : labels.defaultName,
        }),
      );
  }
  return [
    normalizeChannel(
      {
        id: "default",
        name: labels.defaultName,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        apiFormat: config.apiFormat,
        models: normalizeChannelModels(
          [
            config.model,
            config.imageModel,
            config.videoModel,
            config.textModel,
            config.audioModel,
          ].map(modelOptionName),
        ),
      },
      { id: "default", name: labels.defaultName },
    ),
  ];
}

/** Decode legacy snapshots independently of browser storage and the host model catalog. */
export function migrateConfigSnapshot(
  value: unknown,
  labels: ChannelLabels,
): ConfigSnapshot {
  const state = recordValue(value);
  const input = recordValue(state.config);
  const config = readPreferences(input);
  config.channels = readChannels(input, config, labels);
  config.models = modelOptionsFromChannels(config.channels);
  config.imageModel = normalizeModelOptionValue(
    config.imageModel || config.model,
    config.channels,
  );
  config.videoModel = normalizeModelOptionValue(
    config.videoModel,
    config.channels,
  );
  config.textModel = normalizeModelOptionValue(
    config.textModel || config.model,
    config.channels,
  );
  config.audioModel = normalizeModelOptionValue(
    config.audioModel,
    config.channels,
  );
  const storedWebdav = recordValue(state.webdav);
  const webdav = { ...defaultWebdavSyncConfig };
  for (const key of ["url", "username", "directory", "lastSyncedAt"] as const)
    webdav[key] = textValue(storedWebdav[key], webdav[key]);
  // Password persistence was retired; old snapshots must not restore one.
  webdav.password = "";
  return { config, webdav };
}

export function serializeConfigSnapshot(
  snapshot: ConfigSnapshot,
  project: (config: AiConfig) => AiConfig,
): ConfigSnapshot {
  return {
    config: project(snapshot.config),
    webdav: { ...snapshot.webdav, password: "" },
  };
}
