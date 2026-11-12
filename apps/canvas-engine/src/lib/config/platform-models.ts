import { DEFAULT_LOCAL_PROXY_URL } from "./defaults";
import {
  createChannelModelIndex,
  encodeChannelModel,
  modelOptionName,
  normalizeLocalProxyUrl,
} from "./channel-models";
import type { AiConfig, ChannelModel, ModelCapability } from "./types";

type PlatformModel = { id: string; name?: string; available: boolean };
export type ModelCatalog = { image: PlatformModel[]; video: PlatformModel[] };
type GenerationCapability = "image" | "video";

function availableModel(
  catalog: ModelCatalog | undefined,
  preferred: string,
  capability: GenerationCapability,
): string {
  const choices = catalog?.[capability] || [];
  const name = modelOptionName(preferred);
  const selected =
    choices.find((item) => item.id === name && item.available) ||
    choices.find((item) => item.available);
  return selected ? encodeChannelModel("platform", selected.id) : "";
}

export function resolveCapabilityModel(
  config: AiConfig,
  current: string | undefined,
  capability: ModelCapability,
  catalog: ModelCatalog | undefined,
): string {
  const configured = current
    ? createChannelModelIndex(config.channels).find(current)?.model.capability
    : undefined;
  if (current && (!configured || configured === capability)) return current;
  const preference = {
    image: config.imageModel,
    video: config.videoModel,
    text: config.textModel,
    audio: config.audioModel,
  }[capability];
  return capability === "image" || capability === "video"
    ? availableModel(catalog, preference, capability)
    : preference;
}

export function isCatalogModelReady(
  config: AiConfig,
  value: string,
  catalog: ModelCatalog | undefined,
): boolean {
  const match = createChannelModelIndex(config.channels).find(value);
  if (
    !match ||
    (match.model.capability !== "image" && match.model.capability !== "video")
  )
    return false;
  return Boolean(
    catalog?.[match.model.capability].some(
      (item) => item.id === match.model.name && item.available,
    ),
  );
}

/** Project local preferences onto the current host-owned provider catalog. */
export function applyPlatformCatalog(
  config: AiConfig,
  catalog: ModelCatalog | undefined,
): AiConfig {
  const entries: ChannelModel[] = [];
  for (const capability of ["image", "video"] as const) {
    for (const model of catalog?.[capability] || [])
      entries.push({ name: model.id, capability });
  }
  const imageModel = availableModel(catalog, config.imageModel, "image");
  const videoModel = availableModel(catalog, config.videoModel, "video");
  const current = modelOptionName(config.model);
  const keepCurrent =
    entries.some((entry) => entry.name === current) &&
    [...(catalog?.image || []), ...(catalog?.video || [])].some(
      (entry) => entry.id === current && entry.available,
    );
  return {
    ...config,
    baseUrl: "",
    apiKey: "",
    apiFormat: "openai",
    channelMode: "local",
    channels: [
      {
        id: "platform",
        name: "映序平台账号池",
        baseUrl: "",
        apiKey: "",
        apiFormat: "openai",
        models: entries,
      },
    ],
    models: entries.map((entry) => encodeChannelModel("platform", entry.name)),
    model: keepCurrent
      ? encodeChannelModel("platform", current)
      : imageModel || videoModel,
    imageModel,
    videoModel,
    textModel: "",
    audioModel: "",
    proxyEnabled: Boolean(config.proxyEnabled),
    proxyUrl: normalizeLocalProxyUrl(
      config.proxyUrl || DEFAULT_LOCAL_PROXY_URL,
    ),
  };
}

export function catalogModelLabel(
  catalog: ModelCatalog | undefined,
  name: string,
): string | undefined {
  const model = [...(catalog?.image || []), ...(catalog?.video || [])].find(
    (entry) => entry.id === name,
  );
  return model
    ? `${model.name || model.id}${model.available ? "" : " · 未就绪"}`
    : undefined;
}
