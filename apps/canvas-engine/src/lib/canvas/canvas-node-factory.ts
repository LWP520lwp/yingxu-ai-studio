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

type Dimensions = { width?: number; height?: number };

function finite(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function mediaDimensions(media: Dimensions) {
  const width = finite(media.width, 0);
  const height = finite(media.height, 0);
  return {
    ...(width > 0 ? { naturalWidth: width } : {}),
    ...(height > 0 ? { naturalHeight: height } : {}),
  };
}

function mediaMetadataBase(
  media: UploadedFile | UploadedImage,
  fallbackMimeType: string,
): CanvasNodeMetadata {
  const durationMs = "durationMs" in media ? media.durationMs : undefined;
  return {
    content: typeof media.url === "string" ? media.url : "",
    ...(typeof media.storageKey === "string" && media.storageKey
      ? { storageKey: media.storageKey }
      : {}),
    status: "success",
    ...mediaDimensions(media),
    bytes: nonNegative(media.bytes),
    mimeType:
      typeof media.mimeType === "string" && media.mimeType.trim()
        ? media.mimeType
        : fallbackMimeType,
    ...(typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= 0
      ? { durationMs }
      : {}),
  };
}

function centeredPosition(position: Position, width: number, height: number) {
  const centerX = finite(position?.x, 0);
  const centerY = finite(position?.y, 0);
  return { x: centerX - width / 2, y: centerY - height / 2 };
}

function validDimension(value: number | undefined, fallback: number) {
  return Math.max(1, finite(value, fallback));
}

function referenceUrlOrEmpty(image: ReferenceImage) {
  if (typeof image?.storageKey === "string" && image.storageKey.trim())
    return image.storageKey;
  if (typeof image?.url === "string" && image.url.trim()) return image.url;
  if (
    typeof image?.dataUrl === "string" &&
    image.dataUrl &&
    !/^data:/i.test(image.dataUrl)
  ) {
    return image.dataUrl;
  }
  return undefined;
}

/** Create a node whose supplied world position identifies its center. */
export function createCanvasNode(
  type: CanvasNodeTypeId,
  position: Position,
  metadata?: CanvasNodeMetadata,
): CanvasNodeData {
  const spec = getNodeSpec(type);
  const width = validDimension(spec.width, 340);
  const baseHeight = validDimension(spec.height, 240);
  const height =
    type === CanvasNodeType.Config && metadata?.generationMode === "video"
      ? Math.max(360, baseHeight)
      : baseHeight;
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    type,
    title: spec.title,
    position: centeredPosition(position, width, height),
    width,
    height,
    metadata: { ...spec.metadata, ...metadata },
  };
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
  return mediaMetadataBase(image, "image/png");
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
  return mediaMetadataBase(video, "video/mp4");
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
  const metadata = mediaMetadataBase(audio, "audio/mpeg");
  delete metadata.naturalWidth;
  delete metadata.naturalHeight;
  return metadata;
}

export function referenceUrl(image: ReferenceImage) {
  return referenceUrlOrEmpty(image);
}

export function buildImageGenerationMetadata(
  type: CanvasImageGenerationType,
  config: AiConfig,
  count: number,
  references: ReferenceImage[],
): CanvasNodeMetadata {
  const urls = (Array.isArray(references) ? references : [])
    .map(referenceUrlOrEmpty)
    .filter((url): url is string => Boolean(url));
  return {
    generationType: type,
    model: config.model,
    size: config.size,
    quality: config.quality,
    ...(config.background ? { background: config.background } : {}),
    count: Math.max(1, Math.floor(finite(count, 1))),
    references: urls,
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
) {
  const safePatch = patch || {};
  const next = { ...node, metadata: { ...node.metadata, ...safePatch } };

  if (
    node.type === CanvasNodeType.Config &&
    (safePatch.generationMode === "video" ||
      safePatch.videoSkillId !== undefined)
  ) {
    return { ...next, height: Math.max(360, validDimension(node.height, 360)) };
  }

  if (
    (node.type !== CanvasNodeType.Image &&
      node.type !== CanvasNodeType.Video) ||
    typeof safePatch.size !== "string" ||
    Boolean(node.metadata?.content)
  ) {
    return next;
  }

  const spec =
    node.type === CanvasNodeType.Image
      ? NODE_DEFAULT_SIZE.image
      : NODE_DEFAULT_SIZE.video;
  const size = nodeSizeFromRatio(safePatch.size, spec.width, spec.height);
  if (!size) return next;

  const currentWidth = validDimension(node.width, spec.width);
  const currentHeight = validDimension(node.height, spec.height);
  const centerX = finite(node.position?.x, 0) + currentWidth / 2;
  const centerY = finite(node.position?.y, 0) + currentHeight / 2;
  return {
    ...next,
    ...size,
    position: {
      x: centerX - size.width / 2,
      y: centerY - size.height / 2,
    },
  };
}
