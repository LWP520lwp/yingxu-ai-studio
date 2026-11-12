import type { AiConfig, ChannelCredentialsImportResult } from "./types";
import type { ChannelFactory } from "./channel-models";

export function importChannelCredentials(
  config: AiConfig,
  input: { baseUrl?: string | null; apiKey?: string | null },
  createModelChannel: ChannelFactory,
  unnamedChannel: string,
): ChannelCredentialsImportResult & { config: AiConfig } {
  const rawBaseUrl = input.baseUrl?.trim() || "";
  if (!rawBaseUrl) return { status: "missing-base-url", config };
  if (!isHttpBaseUrl(rawBaseUrl)) return { status: "invalid-base-url", config };

  const baseUrl = normalizeImportedBaseUrl(rawBaseUrl);
  const apiKey = input.apiKey?.trim() || "";
  const matchingIndex = config.channels.findIndex(
    (channel) =>
      normalizedBaseUrlKey(channel.baseUrl) === normalizedBaseUrlKey(baseUrl),
  );

  if (matchingIndex >= 0) {
    const existing = config.channels[matchingIndex];
    if (
      existing.baseUrl === baseUrl &&
      (!apiKey || existing.apiKey === apiKey)
    ) {
      return { status: "updated", channelName: existing.name, config };
    }
    const updated = { ...existing, baseUrl, ...(apiKey ? { apiKey } : {}) };
    const channels = config.channels.map((channel, index) =>
      index === matchingIndex ? updated : channel,
    );
    return {
      status: "updated",
      channelName: existing.name,
      config: { ...config, channels },
    };
  }

  const channel = createModelChannel({
    name: importedChannelName(baseUrl, unnamedChannel),
    baseUrl,
    apiKey,
    apiFormat: "openai",
    models: [],
  });
  return {
    status: "created",
    channelName: channel.name,
    config: { ...config, channels: [...config.channels, channel] },
  };
}

function isHttpBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname)
    );
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

function importedChannelName(baseUrl: string, unnamedChannel: string) {
  const hostname = new URL(baseUrl).hostname;
  return hostname.replace(/^(?:www|api)\./i, "") || unnamedChannel;
}
