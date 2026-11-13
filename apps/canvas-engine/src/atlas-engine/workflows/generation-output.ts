import { CanvasNodeType, type CanvasConnection, type CanvasImageGenerationType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

const FRAME = {
  [CanvasNodeType.Image]: { width: 340, height: 240 },
  [CanvasNodeType.Text]: { width: 340, height: 240 },
  [CanvasNodeType.Config]: { width: 340, height: 240 },
} as const;

type SourceDisposition = "busy" | "replace-image" | "finish-image" | "retain-prompt";

export type AtlasImageOutputPlan = Readonly<{
  sourceId: string;
  sourcePrompt: string;
  outputId: string;
  imageIds: readonly string[];
  outputNode: CanvasNodeData;
  references: readonly ReferenceImage[];
  generationType: CanvasImageGenerationType;
  reusesSource: boolean;
  isConfigurationSource: boolean;
  sourceDisposition: SourceDisposition;
  connection?: CanvasConnection;
}>;

export type AtlasImageOutputInput = Readonly<{
  sourceId: string;
  sourceNode?: CanvasNodeData;
  prompt: string;
  sourcePrompt: string;
  config: AiConfig;
  overwriteExisting: boolean;
  count: number;
  references: readonly ReferenceImage[];
  createId: () => string;
}>;

function isFilledImage(node: CanvasNodeData | undefined): node is CanvasNodeData {
  return node?.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
}

function imageReference(node: CanvasNodeData): ReferenceImage {
  return {
    id: node.id,
    name: `${node.title || node.id}.png`,
    type: node.metadata?.mimeType || "image/png",
    dataUrl: node.metadata?.content || "",
    storageKey: node.metadata?.storageKey,
  };
}

function uniqueById(references: readonly ReferenceImage[]): ReferenceImage[] {
  const byId = new Map<string, ReferenceImage>();
  for (const item of references) byId.set(item.id, item);
  return [...byId.values()];
}

function referenceLocator(reference: ReferenceImage): string | undefined {
  const storageKey = reference.storageKey?.trim();
  if (storageKey) return storageKey;
  const url = reference.url?.trim();
  if (url) return url;
  const legacyUrl = reference.dataUrl.trim();
  return legacyUrl && !/^data:/i.test(legacyUrl) ? legacyUrl : undefined;
}

function imageGenerationMetadata(
  config: AiConfig,
  amount: number,
  references: readonly ReferenceImage[],
  generationType: CanvasImageGenerationType,
): CanvasNodeMetadata {
  return {
    generationType,
    model: config.model,
    size: config.size,
    quality: config.quality,
    ...(config.background ? { background: config.background } : {}),
    count: Math.max(1, Math.floor(Number.isFinite(amount) ? amount : 1)),
    references: references.map(referenceLocator).filter((item): item is string => Boolean(item)),
  };
}

export function planAtlasImageOutput(input: AtlasImageOutputInput): AtlasImageOutputPlan {
  const source = input.sourceNode;
  const isConfigurationSource = source?.type === CanvasNodeType.Config;
  const hasImage = isFilledImage(source);
  const reusesSource = source?.type === CanvasNodeType.Image && (input.overwriteExisting || !hasImage);
  const parentKind = isConfigurationSource
    ? CanvasNodeType.Config
    : source?.type === CanvasNodeType.Image
      ? CanvasNodeType.Image
      : CanvasNodeType.Text;
  const parentSize = FRAME[parentKind];
  const imageSize = FRAME[CanvasNodeType.Image];
  const imageCount = Math.max(1, Math.floor(Number.isFinite(input.count) ? input.count : 1));
  const outputId = reusesSource ? input.sourceId : input.createId();
  const imageIds = Array.from({ length: imageCount }, input.createId);
  const references = uniqueById([
    ...(hasImage && !input.overwriteExisting && source ? [imageReference(source)] : []),
    ...input.references,
  ]);
  const generationType: CanvasImageGenerationType = references.length ? "edit" : "generation";
  const origin = source?.position ?? { x: 0, y: 0 };
  const outputPosition = reusesSource
    ? { ...origin }
    : {
        x: origin.x + parentSize.width + 96,
        y: origin.y + parentSize.height / 2 - imageSize.height / 2,
      };
  const outputNode: CanvasNodeData = {
    id: outputId,
    type: CanvasNodeType.Image,
    title: input.prompt.slice(0, 32) || "Generated Image",
    position: outputPosition,
    width: reusesSource ? source?.width || imageSize.width : imageSize.width,
    height: reusesSource ? source?.height || imageSize.height : imageSize.height,
    metadata: {
      prompt: input.prompt,
      status: "loading",
      images: imageIds.map((id) => ({
        id,
        status: "loading",
        content: "",
        naturalWidth: 0,
        naturalHeight: 0,
        bytes: 0,
        mimeType: "",
      })),
      primaryImageId: undefined,
      ...imageGenerationMetadata(input.config, imageCount, references, generationType),
    },
  };

  const sourceDisposition: SourceDisposition = isConfigurationSource
    ? "busy"
    : reusesSource
      ? "replace-image"
      : source?.type === CanvasNodeType.Image
        ? "finish-image"
        : "retain-prompt";

  return {
    sourceId: input.sourceId,
    sourcePrompt: input.sourcePrompt,
    outputId,
    imageIds,
    outputNode,
    references,
    generationType,
    reusesSource,
    isConfigurationSource,
    sourceDisposition,
    ...(reusesSource
      ? {}
      : { connection: { id: input.createId(), fromNodeId: input.sourceId, toNodeId: outputId } }),
  };
}

export function applyAtlasImageOutputPlan(
  nodes: readonly CanvasNodeData[],
  plan: AtlasImageOutputPlan,
): CanvasNodeData[] {
  const next = nodes.map((node): CanvasNodeData => {
    if (node.id !== plan.sourceId) return node;
    const metadata = node.metadata ?? {};
    switch (plan.sourceDisposition) {
      case "busy":
        return { ...node, metadata: { ...metadata, status: "loading", errorDetails: undefined } };
      case "replace-image":
        return {
          ...node,
          ...plan.outputNode,
          metadata: {
            ...metadata,
            ...plan.outputNode.metadata,
            content: undefined,
            storageKey: undefined,
            naturalWidth: undefined,
            naturalHeight: undefined,
            bytes: undefined,
            mimeType: undefined,
            errorDetails: undefined,
          },
        };
      case "finish-image":
        return { ...node, metadata: { ...metadata, status: "success", errorDetails: undefined } };
      case "retain-prompt":
        return {
          ...node,
          type: CanvasNodeType.Text,
          title: plan.sourcePrompt.slice(0, 32) || "Prompt",
          width: FRAME[CanvasNodeType.Text].width,
          height: FRAME[CanvasNodeType.Text].height,
          metadata: {
            ...metadata,
            content: plan.sourcePrompt,
            prompt: plan.sourcePrompt,
            status: "success",
            fontSize: 14,
            errorDetails: undefined,
          },
        };
    }
  });
  return plan.reusesSource ? next : [...next, plan.outputNode];
}

export function applyAtlasImageSuccess(
  nodes: readonly CanvasNodeData[],
  outputId: string,
  result: CanvasNodeImage,
): CanvasNodeData[] {
  return nodes.map((node) => {
    if (node.id !== outputId) return node;
    const images = (node.metadata?.images ?? []).map((item) => item.id === result.id ? result : item);
    if (node.metadata?.primaryImageId) {
      return { ...node, metadata: { ...node.metadata, images } };
    }

    const dimensions = containImage(result.naturalWidth, result.naturalHeight, FRAME[CanvasNodeType.Image]);
    const center = {
      x: node.position.x + node.width / 2,
      y: node.position.y + node.height / 2,
    };
    const position = centerPosition(center, dimensions);
    return {
      ...node,
      position,
      ...dimensions,
      metadata: {
        ...node.metadata,
        content: result.content,
        storageKey: result.storageKey,
        naturalWidth: result.naturalWidth,
        naturalHeight: result.naturalHeight,
        bytes: result.bytes,
        mimeType: result.mimeType,
        images,
        primaryImageId: result.id,
      },
    };
  });
}

export function applyAtlasImageFailure(
  nodes: readonly CanvasNodeData[],
  outputId: string,
  imageId: string,
  errorDetails: string,
): CanvasNodeData[] {
  return nodes.map((node) => {
    if (node.id !== outputId) return node;
    const images = node.metadata?.images?.map((image) => image.id === imageId
      ? { ...image, status: "error" as const, errorDetails }
      : image);
    return { ...node, metadata: { ...node.metadata, images } };
  });
}

function containImage(width: number, height: number, frame: { width: number; height: number }) {
  const sourceWidth = Number.isFinite(width) && width > 0 ? width : frame.width;
  const sourceHeight = Number.isFinite(height) && height > 0 ? height : frame.height;
  const ratio = Math.min(frame.width / sourceWidth, frame.height / sourceHeight);
  return { width: sourceWidth * ratio, height: sourceHeight * ratio };
}

function centerPosition(center: Position, size: { width: number; height: number }): Position {
  return { x: center.x - size.width / 2, y: center.y - size.height / 2 };
}
