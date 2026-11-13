import {
  defaultConfig,
  resolveModelForCapability,
  type AiConfig,
} from "@/stores/use-config-store";
import { mapConcurrent } from "@/lib/async-pool";
import { atlasImageReference as readCanvasImageReference } from "@/atlas-engine/model/image-reference";
import i18n from "@/i18n";
import {
  ensureImagePreview,
  resolveImageUrl,
  uploadImage,
} from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import {
  atlasImageMetadata,
  atlasReferenceUrl,
} from "@/atlas-engine/model/node-factory";
import type { ReferenceImage } from "@/types/image";
import {
  CanvasNodeType,
  type CanvasAssistantSession,
  type CanvasConnection,
  type CanvasGenerationMode,
  type CanvasNodeData,
  type CanvasNodeMetadata,
} from "@/types/canvas";

type AtlasResourceKind = "text" | "image" | "video" | "audio";
type AtlasGenerationChild = {
  nodeId: string;
  type: AtlasResourceKind;
  title: string;
  text?: string;
};

export type AtlasNodeGenerationInput =
  | AtlasGenerationChild
  | {
      nodeId: string;
      type: "group";
      title: string;
      children: AtlasGenerationChild[];
    };

export type AtlasImageAngle = {
  horizontalAngle: number;
  pitchAngle: number;
  cameraDistance: number;
  wideAngle: boolean;
};

const IMAGE_RESTORE_CONCURRENCY = 4;
const AUDIO_EXTENSIONS =
  /\.(aac|aif|aiff|alac|flac|m4a|mid|midi|mp3|oga|ogg|opus|wav|webm)$/i;

function warmImagePreview(storageKey?: string) {
  if (storageKey) void ensureImagePreview(storageKey).catch(() => undefined);
}

export function atlasImageExtension(dataUrl: string) {
  const declared = dataUrl.match(/^data:image\/([^;,]+)/i)?.[1];
  const pathType = dataUrl.match(/image\/([^;,?]+)/i)?.[1];
  return (declared || pathType || "png").toLowerCase();
}

export function atlasAudioExtension(mimeType?: string) {
  const value = (mimeType || "").toLowerCase();
  if (value.includes("wav")) return "wav";
  if (value.includes("opus")) return "opus";
  if (value.includes("aac")) return "aac";
  if (value.includes("flac")) return "flac";
  if (value.includes("pcm")) return "pcm";
  if (value.includes("webm")) return "webm";
  if (value.includes("mp4")) return "m4a";
  if (value.includes("ogg")) return "ogg";
  return "mp3";
}

export function atlasGenerationReferenceUrls(context: {
  referenceImages: ReferenceImage[];
  referenceVideos: Array<{ storageKey?: string; url?: string }>;
  referenceAudios?: Array<{ storageKey?: string; url?: string }>;
}) {
  const candidates = context.referenceImages
    .map(atlasReferenceUrl)
    .concat(context.referenceVideos.map((item) => item.storageKey || item.url))
    .concat(
      (context.referenceAudios || []).map(
        (item) => item.storageKey || item.url,
      ),
    );
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      seen.has(candidate)
    )
      continue;
    seen.add(candidate);
    unique.push(candidate);
  }
  return unique;
}

export async function resolveAtlasMetadataReferences(
  metadata: CanvasNodeMetadata,
) {
  if (metadata.generationType !== "edit") return [];
  const saved = metadata.references || [];
  if (saved.length === 0) return null;
  const resolved = await Promise.all(
    saved.map(async (locator, index) => {
      const storageKey = locator.startsWith("image:") ? locator : undefined;
      const dataUrl = storageKey
        ? await resolveImageUrl(storageKey, "")
        : locator;
      if (!dataUrl) return undefined;
      return {
        id: String(index),
        name: `reference-${index}.png`,
        type: "image/png",
        dataUrl,
        ...(storageKey ? { storageKey } : {}),
      } satisfies ReferenceImage;
    }),
  );
  return resolved.every((item): item is ReferenceImage => Boolean(item))
    ? resolved
    : null;
}

type StoredImage = NonNullable<CanvasNodeMetadata["images"]>[number];

async function restoreStoredImage(image: StoredImage): Promise<StoredImage> {
  if (!image.storageKey) return image;
  warmImagePreview(image.storageKey);
  const content = await resolveImageUrl(image.storageKey, image.content || "");
  return { ...image, content };
}

async function restoreNode(node: CanvasNodeData): Promise<CanvasNodeData> {
  const metadata = node.metadata;
  if (!metadata) return node;

  if (
    (node.type === CanvasNodeType.Video ||
      node.type === CanvasNodeType.Audio) &&
    metadata.storageKey
  ) {
    const content = await resolveMediaUrl(
      metadata.storageKey,
      metadata.content,
    );
    return { ...node, metadata: { ...metadata, content } };
  }
  if (node.type !== CanvasNodeType.Image) return node;

  const savedImages = metadata.images || [];
  const images: StoredImage[] = [];
  for (const image of savedImages) images.push(await restoreStoredImage(image));
  const nestedChanged = images.some(
    (item, index) => item !== savedImages[index],
  );
  if (metadata.storageKey) {
    warmImagePreview(metadata.storageKey);
    const content = await resolveImageUrl(
      metadata.storageKey,
      metadata.content || "",
    );
    return { ...node, metadata: { ...metadata, content, images } };
  }
  if (metadata.content?.startsWith("data:image/")) {
    const uploaded = await uploadImage(metadata.content);
    return {
      ...node,
      metadata: { ...metadata, ...atlasImageMetadata(uploaded), images },
    };
  }
  return nestedChanged ? { ...node, metadata: { ...metadata, images } } : node;
}

export function hydrateAtlasCanvasImages(nodes: CanvasNodeData[]) {
  return mapConcurrent(nodes, IMAGE_RESTORE_CONCURRENCY, restoreNode);
}

async function restoreAssistantReference<
  T extends { dataUrl?: string; storageKey?: string },
>(reference: T): Promise<T> {
  if (reference.storageKey) {
    const dataUrl = await resolveImageUrl(
      reference.storageKey,
      reference.dataUrl || "",
    );
    return { ...reference, dataUrl };
  }
  if (reference.dataUrl?.startsWith("data:image/")) {
    const uploaded = await uploadImage(reference.dataUrl);
    return {
      ...reference,
      dataUrl: uploaded.url,
      storageKey: uploaded.storageKey,
    };
  }
  return reference;
}

export function hydrateAtlasAssistantImages(
  sessions: CanvasAssistantSession[],
) {
  return Promise.all(
    sessions.map(async (session) => ({
      ...session,
      messages: await Promise.all(
        session.messages.map(async (message) => ({
          ...message,
          references: await Promise.all(
            (message.references || []).map(restoreAssistantReference),
          ),
        })),
      ),
    })),
  );
}

export function atlasGenerationCount(input: string) {
  const value = Number(input);
  return Number.isFinite(value)
    ? Math.max(1, Math.min(15, Math.floor(value)))
    : 1;
}

export function atlasInputSummary(inputs: AtlasNodeGenerationInput[]) {
  const uniqueKinds = new Map<string, AtlasResourceKind>();
  for (const input of inputs) {
    if (input.type === "group") {
      for (const child of input.children)
        uniqueKinds.set(child.nodeId, child.type);
    } else {
      uniqueKinds.set(input.nodeId, input.type);
    }
  }
  const summary = { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0 };
  for (const type of uniqueKinds.values()) summary[`${type}Count`] += 1;
  return summary;
}

export function buildAtlasGenerationConfig(
  config: AiConfig,
  node: CanvasNodeData | undefined,
  mode: CanvasGenerationMode,
): AiConfig {
  const metadata = node?.metadata;
  const videoSkillId =
    mode === "video"
      ? (metadata?.videoSkillId ?? metadata?.skillId)
      : undefined;
  return {
    ...config,
    model: resolveModelForCapability(config, metadata?.model, mode),
    reasoningEffort:
      metadata?.reasoningEffort ||
      config.reasoningEffort ||
      defaultConfig.reasoningEffort,
    quality: metadata?.quality ?? config.quality ?? defaultConfig.quality,
    size: metadata?.size ?? config.size ?? defaultConfig.size,
    background:
      metadata?.background ?? config.background ?? defaultConfig.background,
    videoSeconds:
      metadata?.seconds ?? config.videoSeconds ?? defaultConfig.videoSeconds,
    vquality: metadata?.vquality ?? config.vquality ?? defaultConfig.vquality,
    videoGenerateAudio:
      metadata?.generateAudio ??
      config.videoGenerateAudio ??
      defaultConfig.videoGenerateAudio,
    videoWatermark:
      metadata?.watermark ??
      config.videoWatermark ??
      defaultConfig.videoWatermark,
    videoMode:
      metadata?.videoMode ?? config.videoMode ?? defaultConfig.videoMode,
    videoFramesReversed: metadata?.videoFramesReversed ?? false,
    videoSkillId,
    videoSkillVersion:
      mode === "video"
        ? (metadata?.videoSkillVersion ?? metadata?.skillVersion)
        : undefined,
    videoSkillReviewRequired:
      mode === "video" &&
      Boolean(videoSkillId) &&
      metadata?.videoSkillInputMode !== "instruction",
    appliedSkillId: mode === "image" ? metadata?.skillId : undefined,
    appliedSkillVersion: mode === "image" ? metadata?.skillVersion : undefined,
    audioVoice:
      metadata?.audioVoice ?? config.audioVoice ?? defaultConfig.audioVoice,
    audioFormat:
      metadata?.audioFormat ?? config.audioFormat ?? defaultConfig.audioFormat,
    audioSpeed:
      metadata?.audioSpeed ?? config.audioSpeed ?? defaultConfig.audioSpeed,
    audioInstructions:
      metadata?.audioInstructions ??
      config.audioInstructions ??
      defaultConfig.audioInstructions,
    count: String(
      metadata?.count ??
        (mode === "image"
          ? (config.canvasImageCount ?? config.count)
          : config.count) ??
        defaultConfig.count,
    ),
  };
}

export function hasAtlasResumableVideoTask(node: CanvasNodeData) {
  return (
    node.type === CanvasNodeType.Video &&
    Boolean(node.metadata?.videoTaskId) &&
    !node.metadata?.content
  );
}

export function resetAtlasInterruptedGeneration(nodes: CanvasNodeData[]) {
  const message = i18n.t("canvas.generation.interrupted");
  return nodes.map((node) => {
    const current = node.metadata;
    if (current?.status !== "loading" || hasAtlasResumableVideoTask(node))
      return node;
    return {
      ...node,
      metadata: {
        ...current,
        status: "error" as const,
        errorDetails: message,
        images: current.images?.map((image) =>
          image.status === "loading"
            ? { ...image, status: "error" as const, errorDetails: message }
            : image,
        ),
        texts: current.texts?.map((text) =>
          text.status === "loading"
            ? { ...text, status: "error" as const, errorDetails: message }
            : text,
        ),
      },
    };
  });
}

export function isAtlasGenerationCanceled(error: unknown) {
  if (error === null || typeof error !== "object") return false;
  const value = error as { name?: unknown; message?: unknown; code?: unknown };
  return (
    value.name === "AbortError" ||
    value.name === "CanceledError" ||
    value.code === "ERR_CANCELED" ||
    value.message === i18n.t("common.requestCanceled")
  );
}

export function findAtlasRetrySourceNode(
  targetId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const predecessors = new Map<string, string[]>();
  for (const connection of connections) {
    const list = predecessors.get(connection.toNodeId);
    if (list) list.push(connection.fromNodeId);
    else predecessors.set(connection.toNodeId, [connection.fromNodeId]);
  }

  const visited = new Set<string>([targetId]);
  const frontier = [...(predecessors.get(targetId) || [])];
  for (let cursor = 0; cursor < frontier.length; cursor += 1) {
    const id = frontier[cursor];
    if (visited.has(id)) continue;
    visited.add(id);
    const candidate = byId.get(id);
    if (candidate?.type === CanvasNodeType.Config) return candidate;
    for (const sourceId of predecessors.get(id) || []) {
      if (!visited.has(sourceId)) frontier.push(sourceId);
    }
  }
  return null;
}

export function atlasSourceNodeReferenceImages(node: CanvasNodeData | null) {
  if (node?.type !== CanvasNodeType.Image) return [];
  const image = readCanvasImageReference(node);
  return image ? [image] : [];
}

export function isAtlasAudioFile(file: Pick<File, "type" | "name">) {
  return (
    (file.type || "").toLowerCase().startsWith("audio/") ||
    AUDIO_EXTENSIONS.test(file.name)
  );
}

export function buildAtlasAngleLabel(params: AtlasImageAngle) {
  const horizontal =
    params.horizontalAngle === 0
      ? i18n.t("canvas.generation.front")
      : params.horizontalAngle > 0
        ? i18n.t("canvas.generation.rotateRight", {
            angle: params.horizontalAngle,
          })
        : i18n.t("canvas.generation.rotateLeft", {
            angle: Math.abs(params.horizontalAngle),
          });
  const pitch =
    params.pitchAngle === 0
      ? i18n.t("canvas.generation.level")
      : params.pitchAngle > 0
        ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle })
        : i18n.t("canvas.generation.lowAngle", {
            angle: Math.abs(params.pitchAngle),
          });
  return i18n.t("canvas.generation.angleLabel", {
    horizontal,
    pitch,
    distance: params.cameraDistance.toFixed(1),
    lens: i18n.t(
      params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard",
    ),
  });
}

export function buildAtlasAnglePrompt(params: AtlasImageAngle) {
  return i18n.t("canvas.generation.anglePrompt", {
    angle: buildAtlasAngleLabel(params),
  });
}
