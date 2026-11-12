import { nanoid } from "nanoid";

import { getNodeSpec, NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
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

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function validExtent(value: unknown, fallback: number): number {
  return Math.max(1, numberOr(value, fallback));
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

function centeredAt(center: Position, width: number, height: number): Position {
  return {
    x: numberOr(center?.x, 0) - width / 2,
    y: numberOr(center?.y, 0) - height / 2,
  };
}

function describeMedia(
  media: UploadedFile | UploadedImage,
  defaultMime: string,
  includeDimensions = true,
): CanvasNodeMetadata {
  const mime = typeof media.mimeType === "string" ? media.mimeType.trim() : "";
  const storageKey =
    typeof media.storageKey === "string" ? media.storageKey.trim() : "";
  const duration = nonNegativeMetadata(
    "durationMs" in media ? media.durationMs : undefined,
  );
  const width = includeDimensions ? positiveMetadata(media.width) : undefined;
  const height = includeDimensions ? positiveMetadata(media.height) : undefined;

  return {
    content: typeof media.url === "string" ? media.url : "",
    status: "success",
    bytes: Math.max(0, numberOr(media.bytes, 0)),
    mimeType: mime || defaultMime,
    ...(storageKey ? { storageKey } : {}),
    ...(width ? { naturalWidth: width } : {}),
    ...(height ? { naturalHeight: height } : {}),
    ...(duration !== undefined ? { durationMs: duration } : {}),
  };
}

function chooseReferenceLocator(image: ReferenceImage): string | undefined {
  const storageKey =
    typeof image?.storageKey === "string" ? image.storageKey.trim() : "";
  if (storageKey) return storageKey;

  const url = typeof image?.url === "string" ? image.url.trim() : "";
  if (url) return url;

  const legacy = typeof image?.dataUrl === "string" ? image.dataUrl.trim() : "";
  return legacy && !/^data:/i.test(legacy) ? legacy : undefined;
}

/** Positions supplied by callers describe the visual center of the new node. */
export function createCanvasNode(
  type: CanvasNodeTypeId,
  center: Position,
  metadata?: CanvasNodeMetadata,
): CanvasNodeData {
  const spec = getNodeSpec(type);
  const width = validExtent(spec.width, 340);
  const baseHeight = validExtent(spec.height, 240);
  const height =
    type === CanvasNodeType.Config && metadata?.generationMode === "video"
      ? Math.max(360, baseHeight)
      : baseHeight;

  return {
    id: `${type}-${nanoid(10)}`,
    type,
    title: spec.title,
    position: centeredAt(center, width, height),
    width,
    height,
    metadata: { ...spec.metadata, ...metadata },
  };
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
  return describeMedia(image, "image/png");
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
  return describeMedia(video, "video/mp4");
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
  return describeMedia(audio, "audio/mpeg", false);
}

export function referenceUrl(image: ReferenceImage) {
  return chooseReferenceLocator(image);
}

export function buildImageGenerationMetadata(
  type: CanvasImageGenerationType,
  config: AiConfig,
  count: number,
  references: ReferenceImage[],
): CanvasNodeMetadata {
  const locators = (Array.isArray(references) ? references : [])
    .map(chooseReferenceLocator)
    .filter((locator): locator is string => Boolean(locator));

  return {
    generationType: type,
    model: config.model,
    size: config.size,
    quality: config.quality,
    ...(config.background ? { background: config.background } : {}),
    count: Math.max(1, Math.floor(numberOr(count, 1))),
    references: locators,
  };
}

export function buildAudioGenerationMetadata(
  config: AiConfig,
): CanvasNodeMetadata {
  return {
    model: config.model,
    audioVoice: config.audioVoice,
    audioFormat: config.audioFormat,
    audioSpeed: config.audioSpeed,
    audioInstructions: config.audioInstructions,
  };
}

export function applyNodeConfigPatch(
  node: CanvasNodeData,
  patch: Partial<CanvasNodeData["metadata"]>,
): CanvasNodeData {
  const change = patch ?? {};
  const next = { ...node, metadata: { ...node.metadata, ...change } };

  if (
    node.type === CanvasNodeType.Config &&
    (change.generationMode === "video" || change.videoSkillId !== undefined)
  ) {
    return { ...next, height: Math.max(360, validExtent(node.height, 360)) };
  }

  const isResizableMedia =
    node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video;
  if (
    !isResizableMedia ||
    typeof change.size !== "string" ||
    Boolean(node.metadata?.content)
  ) {
    return next;
  }

  const fallback =
    node.type === CanvasNodeType.Image
      ? NODE_DEFAULT_SIZE.image
      : NODE_DEFAULT_SIZE.video;
  const dimensions = nodeSizeFromRatio(
    change.size,
    fallback.width,
    fallback.height,
  );
  if (!dimensions) return next;

  const width = validExtent(node.width, fallback.width);
  const height = validExtent(node.height, fallback.height);
  const center = {
    x: numberOr(node.position?.x, 0) + width / 2,
    y: numberOr(node.position?.y, 0) + height / 2,
  };
  return {
    ...next,
    ...dimensions,
    position: centeredAt(center, dimensions.width, dimensions.height),
  };
}
