import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { buildImageGenerationMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasImageGenerationType,
  type CanvasNodeData,
  type CanvasNodeImage,
} from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

type SourceTransition = "busy" | "replace" | "settled" | "prompt";

export type CanvasImageOutputPlan = Readonly<{
  sourceId: string;
  sourcePrompt: string;
  outputId: string;
  imageIds: string[];
  outputNode: CanvasNodeData;
  references: ReferenceImage[];
  generationType: CanvasImageGenerationType;
  reusesSource: boolean;
  isConfigurationSource: boolean;
  sourceTransition: SourceTransition;
  connection?: CanvasConnection;
}>;

export type PlanCanvasImageOutputInput = Readonly<{
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

function imageReferenceFromNode(node: CanvasNodeData): ReferenceImage {
  const metadata = node.metadata ?? {};
  return {
    id: node.id,
    name: `${node.title || node.id}.png`,
    type: metadata.mimeType || "image/png",
    dataUrl: metadata.content || "",
    storageKey: metadata.storageKey,
  };
}

function uniqueReferences(references: readonly ReferenceImage[]) {
  return [...new Map(references.map((reference) => [reference.id, reference])).values()];
}

export function planCanvasImageOutput({
  sourceId,
  sourceNode,
  prompt,
  sourcePrompt,
  config,
  overwriteExisting,
  count,
  references,
  createId,
}: PlanCanvasImageOutputInput): CanvasImageOutputPlan {
  const isImageSource = sourceNode?.type === CanvasNodeType.Image;
  const isConfigurationSource = sourceNode?.type === CanvasNodeType.Config;
  const hasImage = Boolean(sourceNode?.metadata?.content);
  const reusesSource =
    isImageSource && (overwriteExisting || !hasImage);
  const parentType = isConfigurationSource
    ? CanvasNodeType.Config
    : isImageSource
      ? CanvasNodeType.Image
      : CanvasNodeType.Text;
  const parentSize = NODE_DEFAULT_SIZE[parentType];
  const imageSize = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
  const parentPosition = sourceNode?.position ?? { x: 0, y: 0 };
  const imageCount = Number.isFinite(count)
    ? Math.max(1, Math.floor(count))
    : 1;
  const outputId = reusesSource ? sourceId : createId();
  const imageIds = Array.from({ length: imageCount }, createId);
  const referencesWithSource = uniqueReferences([
    ...(isImageSource && hasImage && !overwriteExisting && sourceNode
      ? [imageReferenceFromNode(sourceNode)]
      : []),
    ...references,
  ]);
  const generationType = referencesWithSource.length ? "edit" : "generation";
  const position = reusesSource
    ? parentPosition
    : {
        x: parentPosition.x + parentSize.width + 96,
        y: parentPosition.y + parentSize.height / 2 - imageSize.height / 2,
      };

  const outputNode: CanvasNodeData = {
    id: outputId,
    type: CanvasNodeType.Image,
    title: prompt.slice(0, 32) || "Generated Image",
    position,
    width: reusesSource ? sourceNode?.width || imageSize.width : imageSize.width,
    height: reusesSource ? sourceNode?.height || imageSize.height : imageSize.height,
    metadata: {
      prompt,
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
      ...buildImageGenerationMetadata(
        generationType,
        config,
        imageCount,
        referencesWithSource,
      ),
    },
  };
  const sourceTransition: SourceTransition = isConfigurationSource
    ? "busy"
    : reusesSource
      ? "replace"
      : isImageSource
        ? "settled"
        : "prompt";

  return {
    sourceId,
    sourcePrompt,
    outputId,
    imageIds,
    outputNode,
    references: referencesWithSource,
    generationType,
    reusesSource,
    isConfigurationSource,
    sourceTransition,
    ...(reusesSource
      ? {}
      : {
          connection: {
            id: createId(),
            fromNodeId: sourceId,
            toNodeId: outputId,
          },
        }),
  };
}

export function applyCanvasImageOutputPlan(
  nodes: readonly CanvasNodeData[],
  plan: CanvasImageOutputPlan,
): CanvasNodeData[] {
  const next = nodes.map((node): CanvasNodeData => {
    if (node.id !== plan.sourceId) return node;

    switch (plan.sourceTransition) {
      case "busy":
        return {
          ...node,
          metadata: {
            ...node.metadata,
            status: "loading",
            errorDetails: undefined,
          },
        };
      case "replace":
        return {
          ...node,
          ...plan.outputNode,
          metadata: {
            ...node.metadata,
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
      case "settled":
        return {
          ...node,
          metadata: {
            ...node.metadata,
            status: "success",
            errorDetails: undefined,
          },
        };
      case "prompt":
        return {
          ...node,
          type: CanvasNodeType.Text,
          title: plan.sourcePrompt.slice(0, 32) || "Prompt",
          width: NODE_DEFAULT_SIZE[CanvasNodeType.Text].width,
          height: NODE_DEFAULT_SIZE[CanvasNodeType.Text].height,
          metadata: {
            ...node.metadata,
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

export function applyCanvasImageBatchSuccess(
  nodes: readonly CanvasNodeData[],
  outputId: string,
  image: CanvasNodeImage,
): CanvasNodeData[] {
  return nodes.map((node) => {
    if (node.id !== outputId) return node;
    const images =
      node.metadata?.images?.map((item) =>
        item.id === image.id ? image : item,
      ) ?? [];
    if (node.metadata?.primaryImageId) {
      return { ...node, metadata: { ...node.metadata, images } };
    }

    const dimensions = fitNodeSize(
      image.naturalWidth,
      image.naturalHeight,
      NODE_DEFAULT_SIZE[CanvasNodeType.Image].width,
      NODE_DEFAULT_SIZE[CanvasNodeType.Image].height,
    );
    const center = {
      x: node.position.x + node.width / 2,
      y: node.position.y + node.height / 2,
    };
    return {
      ...node,
      position: {
        x: center.x - dimensions.width / 2,
        y: center.y - dimensions.height / 2,
      },
      ...dimensions,
      metadata: {
        ...node.metadata,
        content: image.content,
        storageKey: image.storageKey,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        bytes: image.bytes,
        mimeType: image.mimeType,
        images,
        primaryImageId: image.id,
      },
    };
  });
}

export function applyCanvasImageBatchFailure(
  nodes: readonly CanvasNodeData[],
  outputId: string,
  imageId: string,
  errorDetails: string,
): CanvasNodeData[] {
  return nodes.map((node): CanvasNodeData =>
    node.id !== outputId
      ? node
      : {
          ...node,
          metadata: {
            ...node.metadata,
            images: node.metadata?.images?.map((image) =>
              image.id === imageId
                ? { ...image, status: "error", errorDetails }
                : image,
            ),
          },
        },
  );
}
