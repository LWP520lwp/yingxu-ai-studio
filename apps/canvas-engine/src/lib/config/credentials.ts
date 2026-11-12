import type { ChannelFactory } from "./channel-models";
import type { AiConfig, ChannelCredentialsImportResult } from "./types";

type Endpoint = {
  address: string;
  identity: string;
  suggestedName: string;
};

function endpointFrom(value: string): Endpoint | null {
  try {
    const url = new URL(value.trim());
    if (
      !(url.protocol === "https:" || url.protocol === "http:") ||
      !url.hostname
    ) {
      return null;
    }
    url.hash = "";
    const address = url.toString().replace(/\/+$/, "");
    return {
      address,
      identity: address.replace(/\/v1$/i, ""),
      suggestedName: url.hostname.replace(/^(?:www|api)\./i, ""),
    };
  } catch {
    return null;
  }
}

function endpointIdentity(value: string) {
  return (
    endpointFrom(value)?.identity ||
    value.trim().replace(/\/+$/, "").replace(/\/v1$/i, "")
  );
}

export function importChannelCredentials(
  config: AiConfig,
  input: { baseUrl?: string | null; apiKey?: string | null },
  createModelChannel: ChannelFactory,
  unnamedChannel: string,
): ChannelCredentialsImportResult & { config: AiConfig } {
  const rawAddress = input.baseUrl?.trim() || "";
  if (!rawAddress) return { status: "missing-base-url", config };

  const endpoint = endpointFrom(rawAddress);
  if (!endpoint) return { status: "invalid-base-url", config };

  const apiKey = input.apiKey?.trim() || "";
  const existingIndex = config.channels.findIndex(
    (channel) => endpointIdentity(channel.baseUrl) === endpoint.identity,
  );

  if (existingIndex !== -1) {
    const current = config.channels[existingIndex];
    if (
      current.baseUrl === endpoint.address &&
      (!apiKey || current.apiKey === apiKey)
    ) {
      return { status: "updated", channelName: current.name, config };
    }
    const channels = config.channels.slice();
    channels[existingIndex] = {
      ...current,
      baseUrl: endpoint.address,
      ...(apiKey ? { apiKey } : {}),
    };
    return {
      status: "updated",
      channelName: current.name,
      config: { ...config, channels },
    };
  }

  const channel = createModelChannel({
    name: endpoint.suggestedName || unnamedChannel,
    baseUrl: endpoint.address,
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
