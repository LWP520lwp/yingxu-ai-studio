import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeText } from "@/types/canvas";
import type { AtlasGenerationEvent } from "@/atlas-engine/workflows/generation-events";
import { applyAtlasImageFailure, applyAtlasImageSuccess } from "@/atlas-engine/workflows/generation-output";
import { atlasAudioMetadata } from "@/atlas-engine/model/node-factory";

export type AtlasGenerationFailure = Readonly<{
  sourceId: string;
  pendingOutputIds: readonly string[];
  markSource: boolean;
  details: string;
  clearFailedVideoTask: boolean;
}>;

export function patchAtlasGenerationMetadata(
  nodes: readonly CanvasNodeData[],
  nodeId: string,
  patch: CanvasNodeMetadata,
): CanvasNodeData[] {
  return nodes.map((node) => node.id === nodeId
    ? { ...node, metadata: { ...node.metadata, ...patch } }
    : node);
}

export function beginAtlasGenerationSource(
  nodes: readonly CanvasNodeData[],
  nodeId: string,
  prompt: string,
): CanvasNodeData[] {
  return nodes.map((node) => node.id === nodeId
    ? { ...node, metadata: { ...node.metadata, ...(node.type === CanvasNodeType.Config ? {} : { prompt }), status: "loading", errorDetails: undefined } }
    : node);
}

/** Applies a failed run only to the source and outputs owned by that run. */
export function applyAtlasGenerationFailure(
  nodes: readonly CanvasNodeData[],
  failure: AtlasGenerationFailure,
): CanvasNodeData[] {
  const failedIds = new Set([failure.sourceId, ...failure.pendingOutputIds]);

  return nodes.map((node) => {
    if (!failedIds.has(node.id)) return node;
    if (node.id === failure.sourceId && !failure.markSource) return node;

    return {
      ...node,
      metadata: {
        ...node.metadata,
        status: "error",
        errorDetails: failure.details,
        ...(failure.clearFailedVideoTask && node.type === CanvasNodeType.Video
          ? { videoTaskId: undefined }
          : {}),
      },
    };
  });
}

export function patchAtlasTextVariant(
  nodes: readonly CanvasNodeData[],
  outputId: string,
  variantId: string,
  patch: Partial<CanvasNodeText>,
): CanvasNodeData[] {
  return nodes.map((node) => {
    if (node.id !== outputId) return node;
    const metadata = node.metadata ?? {};
    const content =
      metadata.primaryTextId === variantId && patch.content !== undefined
        ? patch.content
        : metadata.content;
    const texts = metadata.texts?.map((variant) =>
      variant.id === variantId ? { ...variant, ...patch } : variant,
    );
    return { ...node, metadata: { ...metadata, content, texts } };
  });
}

export function atlasTextBatchOutcome(
  results: readonly (CanvasNodeText | null)[],
) {
  const completed: CanvasNodeText[] = [];
  const failed: CanvasNodeText[] = [];
  for (const result of results) {
    if (result?.status === "success") completed.push(result);
    else if (result?.status === "error") failed.push(result);
  }
  return { completed, failed };
}

export function finalizeAtlasTextBatch(
  nodes: readonly CanvasNodeData[],
  input: Readonly<{
    sourceId: string;
    outputId: string;
    configurationSource: boolean;
    completed: readonly CanvasNodeText[];
    failureDetails: string;
  }>,
): CanvasNodeData[] {
  const status = input.completed.length ? "success" : "error";
  return nodes.map((node) => {
    if (node.id === input.outputId) {
      const primary =
        input.completed.find((text) => text.id === node.metadata?.primaryTextId) ??
        input.completed[0];
      return {
        ...node,
        metadata: {
          ...node.metadata,
          content: primary?.content ?? "",
          texts: [...input.completed],
          primaryTextId: primary?.id,
          status,
          errorDetails: primary ? undefined : input.failureDetails,
        },
      };
    }
    if (node.id !== input.sourceId || !input.configurationSource) return node;
    return {
      ...node,
      metadata: {
        ...node.metadata,
        status,
        errorDetails: input.completed.length ? undefined : input.failureDetails,
      },
    };
  });
}

export function finalizeAtlasImageBatch(
  nodes: readonly CanvasNodeData[],
  input: Readonly<{
    sourceId: string;
    outputId: string;
    configurationSource: boolean;
    hasSuccess: boolean;
    failureDetails: string;
    allFailedDetails: string;
  }>,
): CanvasNodeData[] {
  const status = input.hasSuccess ? "success" : "error";
  return nodes.map((node) => {
    const source = node.id === input.sourceId && input.configurationSource;
    if (!source && node.id !== input.outputId) return node;
    return {
      ...node,
      metadata: {
        ...node.metadata,
        status,
        errorDetails: input.hasSuccess
          ? undefined
          : source ? input.failureDetails : input.allFailedDetails,
      },
    };
  });
}

export function restoreAtlasCancelledImageSource(
  nodes: readonly CanvasNodeData[],
  sourceId: string,
  configurationSource: boolean,
): CanvasNodeData[] {
  if (!configurationSource) return nodes.slice();
  return nodes.map((node) =>
    node.id === sourceId && node.metadata?.status === "loading"
      ? { ...node, metadata: { ...node.metadata, status: "idle", errorDetails: undefined } }
      : node,
  );
}

export function applyAtlasGenerationEvent(
  nodes: readonly CanvasNodeData[],
  outputId: string,
  event: AtlasGenerationEvent,
): CanvasNodeData[] {
  if (event.type === "image-failed") {
    return applyAtlasImageFailure(nodes, outputId, event.variantId, event.details);
  }
  if (event.type === "image-stored") {
    return applyAtlasImageSuccess(nodes, outputId, {
      id: event.variantId,
      status: "success",
      content: event.image.url,
      storageKey: event.image.storageKey,
      naturalWidth: event.image.width,
      naturalHeight: event.image.height,
      bytes: event.image.bytes,
      mimeType: event.image.mimeType,
    });
  }
  if (event.type === "text-patch") {
    return patchAtlasTextVariant(nodes, outputId, event.variantId, event.patch);
  }
  if (event.type === "audio-stored") {
    return nodes.map((node) =>
      node.id === outputId
        ? {
            ...node,
            metadata: {
              ...node.metadata,
              ...atlasAudioMetadata(event.audio),
              ...event.metadata,
            },
          }
        : node,
    );
  }
  return nodes.slice();
}

/** Cancels only still-pending variants and retains completed media in a mixed batch. */
export function cancelAtlasGenerationNodes(
  nodes: readonly CanvasNodeData[],
  affected: ReadonlySet<string>,
  details: string,
): CanvasNodeData[] {
  const cancelPending = <T extends CanvasNodeText>(variant: T): T =>
    variant.status === "loading" ? { ...variant, status: "error", errorDetails: details } : variant;
  return nodes.map((node) => !affected.has(node.id) || node.metadata?.status !== "loading"
    ? node
    : {
        ...node,
        metadata: {
          ...node.metadata,
          status: "idle",
          errorDetails: undefined,
          images: node.metadata.images?.map(cancelPending),
          texts: node.metadata.texts?.map(cancelPending),
        },
      });
}
