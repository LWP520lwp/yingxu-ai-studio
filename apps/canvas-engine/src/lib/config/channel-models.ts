import type {
  ApiCallFormat,
  ChannelModel,
  ModelCapability,
  ModelChannel,
} from "./types";

const SEPARATOR = "::";
const CAPABILITIES = new Set<ModelCapability>([
  "image",
  "video",
  "text",
  "audio",
]);
const HINTS: ReadonlyArray<readonly [ModelCapability, readonly string[]]> = [
  ["video", ["video", "sora", "veo", "kling", "wan", "hailuo"]],
  ["audio", ["audio", "tts", "speech", "voice", "music", "sound"]],
  [
    "image",
    [
      "seedream",
      "gpt-image",
      "image",
      "dall-e",
      "dalle",
      "imagen",
      "flux",
      "sdxl",
      "stable-diffusion",
      "midjourney",
    ],
  ],
];

export type ChannelLabels = {
  newName: string;
  defaultName: string;
  indexedName: (index: number) => string;
};
export type ChannelFactory = (channel?: Partial<ModelChannel>) => ModelChannel;

export function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function guessCapability(name: string): ModelCapability {
  const lower = name.toLowerCase();
  return (
    HINTS.find(([, words]) =>
      words.some((word) => lower.includes(word)),
    )?.[0] || "text"
  );
}

/** Import boundaries accept unknown values; malformed entries never reach the picker. */
export function normalizeChannelModels(models: unknown): ChannelModel[] {
  const byName = new Map<string, ChannelModel>();
  for (const value of Array.isArray(models) ? models : []) {
    const fields = recordValue(value);
    const name = textValue(
      typeof value === "string" ? value : fields.name,
    ).trim();
    if (!name || byName.has(name)) continue;
    const capability = CAPABILITIES.has(fields.capability as ModelCapability)
      ? (fields.capability as ModelCapability)
      : guessCapability(name);
    const script = textValue(fields.script).trim() || undefined;
    byName.set(name, { name, capability, script });
  }
  return [...byName.values()];
}

export function normalizeApiFormat(value: unknown): ApiCallFormat {
  return value === "gemini" ? "gemini" : "openai";
}

export function defaultBaseUrlForApiFormat(format: ApiCallFormat): string {
  return format === "gemini"
    ? "https://generativelanguage.googleapis.com"
    : "https://api.openai.com";
}

export function normalizeChannel(
  value: unknown,
  defaults: { id: string; name: string },
): ModelChannel {
  const fields = recordValue(value);
  const apiFormat = normalizeApiFormat(fields.apiFormat);
  return {
    id: textValue(fields.id).trim() || defaults.id,
    name: textValue(fields.name).trim() || defaults.name,
    baseUrl:
      textValue(fields.baseUrl).trim() || defaultBaseUrlForApiFormat(apiFormat),
    apiKey: textValue(fields.apiKey),
    apiFormat,
    models: normalizeChannelModels(fields.models),
  };
}

export function encodeChannelModel(channelId: string, model: string): string {
  return channelId + SEPARATOR + model.trim();
}

export function decodeChannelModel(
  value: string,
): { channelId: string; model: string } | null {
  const offset = value.indexOf(SEPARATOR);
  return offset < 0
    ? null
    : {
        channelId: value.slice(0, offset),
        model: value.slice(offset + SEPARATOR.length),
      };
}

export function isChannelModelValue(value: string): boolean {
  return value.includes(SEPARATOR);
}

export function modelOptionName(value: string): string {
  return decodeChannelModel(value)?.model || value;
}

type Entry = { channel: ModelChannel; model: ChannelModel };

/** Build once for a group of related queries, without coupling lookup to Zustand. */
export function createChannelModelIndex(channels: readonly ModelChannel[]) {
  const byChannel = new Map<string, ModelChannel>();
  const qualified = new Map<string, Entry>();
  const firstByName = new Map<string, Entry>();
  const optionKeys = new Set<string>();
  const options: string[] = [];
  const byCapability = new Map<ModelCapability, string[]>();
  for (const channel of channels) {
    if (!byChannel.has(channel.id)) byChannel.set(channel.id, channel);
    for (const model of channel.models) {
      const key = encodeChannelModel(channel.id, model.name);
      const entry = { channel, model };
      if (!firstByName.has(model.name)) firstByName.set(model.name, entry);
      // Duplicate channel IDs retain the first channel's resolution semantics.
      if (byChannel.get(channel.id) === channel && !qualified.has(key))
        qualified.set(key, entry);
      if (!optionKeys.has(key)) {
        optionKeys.add(key);
        options.push(key);
      }
      const values = byCapability.get(model.capability) || [];
      values.push(key);
      byCapability.set(model.capability, values);
    }
  }
  return {
    find(value: string): Entry | undefined {
      return decodeChannelModel(value)
        ? qualified.get(value)
        : firstByName.get(value);
    },
    channel(id: string): ModelChannel | undefined {
      return byChannel.get(id);
    },
    options,
    forCapability(capability: ModelCapability): string[] {
      return byCapability.get(capability) || [];
    },
  };
}

export function modelOptionsFromChannels(channels: ModelChannel[]): string[] {
  return createChannelModelIndex(channels).options;
}

export function normalizeModelOptionValue(
  value: string | undefined,
  channels: ModelChannel[],
): string {
  const name = textValue(value).trim();
  if (!name) return "";
  const index = createChannelModelIndex(channels);
  const match = index.find(name);
  if (decodeChannelModel(name)) return match ? name : "";
  return match ? encodeChannelModel(match.channel.id, match.model.name) : name;
}

export function normalizeLocalProxyUrl(value: string): string {
  const address = value.trim().replace(/\/+$/, "");
  return address && !/^https?:\/\//i.test(address)
    ? `http://${address}`
    : address;
}
