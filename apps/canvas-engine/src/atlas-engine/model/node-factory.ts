import { nanoid } from "nanoid";

import { getNodeSpec, NODE_DEFAULT_SIZE } from "@/constant/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import type { ReferenceImage } from "@/types/image";
import {
  CanvasNodeType,
  type CanvasImageGenerationType,
  type CanvasNodeData,
  type CanvasNodeMetadata,
  type CanvasNodeTypeId,
  type Position,
} from "@/types/canvas";
import { atlasNodeSizeFromRatio } from "./node-size";

export type AtlasNodeSpec = Readonly<{
  width: number;
  height: number;
  title: string;
  metadata?: CanvasNodeMetadata;
}>;

type NodeSpecLookup = (type: string) => AtlasNodeSpec;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function extentOr(value: unknown, fallback: number): number {
  return Math.max(1, finiteOr(value, fallback));
}

function positiveMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function nonNegativeMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function cloneMetadata(value: CanvasNodeMetadata | undefined): CanvasNodeMetadata {
  if (!value) return {};
  try {
    return structuredClone(value);
  } catch {
    return { ...value };
  }
}

function centeredPosition(center: Position, width: number, height: number): Position {
  return {
    x: finiteOr(center?.x, 0) - width / 2,
    y: finiteOr(center?.y, 0) - height / 2,
  };
}

function mediaMetadata(
  media: UploadedFile | UploadedImage,
  defaultMime: string,
  includeDimensions = true,
): CanvasNodeMetadata {
  const mime = typeof media.mimeType === "string" ? media.mimeType.trim() : "";
  const storageKey = typeof media.storageKey === "string" ? media.storageKey.trim() : "";
  const duration = nonNegativeMetadata("durationMs" in media ? media.durationMs : undefined);
  const width = includeDimensions ? positiveMetadata(media.width) : undefined;
  const height = includeDimensions ? positiveMetadata(media.height) : undefined;

  return {
    content: typeof media.url === "string" ? media.url : "",
    status: "success",
    bytes: Math.max(0, finiteOr(media.bytes, 0)),
    mimeType: mime || defaultMime,
    ...(storageKey ? { storageKey } : {}),
    ...(width ? { naturalWidth: width } : {}),
    ...(height ? { naturalHeight: height } : {}),
    ...(duration !== undefined ? { durationMs: duration } : {}),
  };
}

function referenceLocator(image: ReferenceImage): string | undefined {
  const key = typeof image?.storageKey === "string" ? image.storageKey.trim() : "";
  if (key) return key;
  const url = typeof image?.url === "string" ? image.url.trim() : "";
  if (url) return url;
  const dataUrl = typeof image?.dataUrl === "string" ? image.dataUrl.trim() : "";
  return dataUrl && !/^data:/i.test(dataUrl) ? dataUrl : undefined;
}

const defaultSpecLookup: NodeSpecLookup = (type) => getNodeSpec(type);

export function createAtlasNode(
  type: CanvasNodeTypeId,
  center: Position,
  metadata?: CanvasNodeMetadata,
  lookupSpec: NodeSpecLookup = defaultSpecLookup,
): CanvasNodeData {
  const spec = lookupSpec(type);
  const width = extentOr(spec.width, 340);
  const baseHeight = extentOr(spec.height, 240);
  const height = type === CanvasNodeType.Config && metadata?.generationMode === "video"
    ? Math.max(360, baseHeight)
    : baseHeight;

  return {
    id: `${type}-${nanoid(10)}`,
    type,
    title: spec.title,
    position: centeredPosition(center, width, height),
    width,
    height,
    metadata: { ...cloneMetadata(spec.metadata), ...metadata },
  };
}

export function atlasImageMetadata(image: UploadedImage): CanvasNodeMetadata {
  return mediaMetadata(image, "image/png");
}

export function atlasVideoMetadata(video: UploadedFile): CanvasNodeMetadata {
  return mediaMetadata(video, "video/mp4");
}

export function atlasAudioMetadata(audio: UploadedFile): CanvasNodeMetadata {
  return mediaMetadata(audio, "audio/mpeg", false);
}

export function atlasReferenceUrl(image: ReferenceImage): string | undefined {
  return referenceLocator(image);
}

export function buildAtlasImageGenerationMetadata(
  type: CanvasImageGenerationType,
  config: AiConfig,
  count: number,
  references: ReferenceImage[],
): CanvasNodeMetadata {
  const locators = (Array.isArray(references) ? references : [])
    .map(referenceLocator)
    .filter((locator): locator is string => Boolean(locator));

  return {
    generationType: type,
    model: config.model,
    size: config.size,
    quality: config.quality,
    ...(config.background ? { background: config.background } : {}),
    count: Math.max(1, Math.floor(finiteOr(count, 1))),
    references: locators,
  };
}

export function buildAtlasAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
  return {
    model: config.model,
    audioVoice: config.audioVoice,
    audioFormat: config.audioFormat,
    audioSpeed: config.audioSpeed,
    audioInstructions: config.audioInstructions,
  };
}

export function patchAtlasNodeConfig(
  node: CanvasNodeData,
  patch: Partial<CanvasNodeMetadata> | undefined,
): CanvasNodeData {
  const change = patch ?? {};
  const updated = { ...node, metadata: { ...node.metadata, ...change } };

  if (node.type === CanvasNodeType.Config &&
      (change.generationMode === "video" || change.videoSkillId !== undefined)) {
    return { ...updated, height: Math.max(360, extentOr(node.height, 360)) };
  }

  const imageOrVideo = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video;
  if (!imageOrVideo || typeof change.size !== "string" || Boolean(node.metadata?.content)) return updated;

  const fallback = node.type === CanvasNodeType.Image
    ? NODE_DEFAULT_SIZE.image
    : NODE_DEFAULT_SIZE.video;
  const dimensions = atlasNodeSizeFromRatio(change.size, fallback.width, fallback.height);
  if (!dimensions) return updated;

  const currentWidth = extentOr(node.width, fallback.width);
  const currentHeight = extentOr(node.height, fallback.height);
  const center = {
    x: finiteOr(node.position?.x, 0) + currentWidth / 2,
    y: finiteOr(node.position?.y, 0) + currentHeight / 2,
  };
  return {
    ...updated,
    ...dimensions,
    position: centeredPosition(center, dimensions.width, dimensions.height),
  };
}

// Old call sites remain source-compatible while the surrounding canvas migrates.
export const createCanvasNode = createAtlasNode;
export const imageMetadata = atlasImageMetadata;
export const videoMetadata = atlasVideoMetadata;
export const audioMetadata = atlasAudioMetadata;
export const referenceUrl = atlasReferenceUrl;
export const buildImageGenerationMetadata = buildAtlasImageGenerationMetadata;
export const buildAudioGenerationMetadata = buildAtlasAudioGenerationMetadata;
export const applyNodeConfigPatch = patchAtlasNodeConfig;
