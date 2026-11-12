import { fitNodeSize } from "./canvas-node-size";
import { applyNodeConfigPatch } from "./canvas-node-factory";
import {
  CanvasNodeType,
  type CanvasNodeData,
  type CanvasNodeMetadata,
  type Position,
} from "@/types/canvas";

/** Document edits are independent of React, storage and provider requests. */
export type CanvasNodeCommand = { nodeId: string } & (
  | { kind: "title" | "prompt" | "content"; value: string }
  | { kind: "font-size"; value: number }
  | { kind: "resize"; width: number; height: number; position?: Position }
  | { kind: "toggle-free-resize" }
  | { kind: "config"; patch: Partial<CanvasNodeData["metadata"]> }
  | { kind: "select-variant" | "remove-variant"; variantId: string }
);

function metadataPatch(
  node: CanvasNodeData,
  patch: Partial<CanvasNodeMetadata>,
): CanvasNodeData {
  if (
    Object.entries(patch).every(([key, value]) =>
      Object.is(node.metadata?.[key as keyof CanvasNodeMetadata], value),
    )
  )
    return node;
  return { ...node, metadata: { ...node.metadata, ...patch } };
}

function useImage(node: CanvasNodeData, id: string): CanvasNodeData {
  const image = node.metadata?.images?.find((candidate) => candidate.id === id);
  if (!image?.content) return node;
  const limit = Math.max(node.width, node.height);
  const size = node.metadata?.freeResize
    ? { width: node.width, height: node.height }
    : fitNodeSize(image.naturalWidth, image.naturalHeight, limit, limit);
  return {
    ...node,
    ...size,
    position: {
      x: node.position.x + (node.width - size.width) / 2,
      y: node.position.y + (node.height - size.height) / 2,
    },
    metadata: {
      ...node.metadata,
      content: image.content,
      storageKey: image.storageKey,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      bytes: image.bytes,
      mimeType: image.mimeType,
      primaryImageId: image.id,
    },
  };
}

function selectVariant(node: CanvasNodeData, id: string): CanvasNodeData {
  if (node.type !== CanvasNodeType.Text) return useImage(node, id);
  const text = node.metadata?.texts?.find((candidate) => candidate.id === id);
  return text?.content
    ? metadataPatch(node, { content: text.content, primaryTextId: id })
    : node;
}

function removeVariant(node: CanvasNodeData, id: string): CanvasNodeData {
  const isText = node.type === CanvasNodeType.Text;
  const items = isText ? node.metadata?.texts : node.metadata?.images;
  if (!items?.some((item) => item.id === id)) return node;
  if (isText) {
    const texts = node.metadata!.texts!.filter((item) => item.id !== id);
    const next = metadataPatch(node, { texts, textCount: texts.length });
    if (node.metadata?.primaryTextId !== id) return next;
    const primary = texts.find((item) => Boolean(item.content));
    return primary
      ? selectVariant(next, primary.id)
      : metadataPatch(next, { content: "", primaryTextId: undefined });
  }
  const images = node.metadata!.images!.filter((item) => item.id !== id);
  const next = metadataPatch(node, { images, count: images.length });
  if (node.metadata?.primaryImageId !== id) return next;
  const primary = images.find((item) => Boolean(item.content));
  if (primary) return useImage(next, primary.id);
  // The preview must not keep displaying a variant that has just been deleted.
  return metadataPatch(next, {
    content: undefined,
    primaryImageId: undefined,
    storageKey: undefined,
    naturalWidth: undefined,
    naturalHeight: undefined,
    bytes: undefined,
    mimeType: undefined,
    status: images.some((item) => item.status === "loading")
      ? "loading"
      : images.some((item) => item.status === "error")
        ? "error"
        : "idle",
  });
}

function editNode(
  node: CanvasNodeData,
  command: CanvasNodeCommand,
): CanvasNodeData {
  switch (command.kind) {
    case "title":
      return node.title === command.value
        ? node
        : { ...node, title: command.value };
    case "prompt":
      return metadataPatch(node, { prompt: command.value });
    case "content":
      return metadataPatch(node, {
        content: command.value,
        ...(node.metadata?.texts?.some(
          (text) =>
            text.id === node.metadata?.primaryTextId &&
            text.content !== command.value,
        )
          ? {
              texts: node.metadata.texts.map((text) =>
                text.id === node.metadata?.primaryTextId
                  ? { ...text, content: command.value }
                  : text,
              ),
            }
          : {}),
      });
    case "font-size":
      return Number.isFinite(command.value) && command.value > 0
        ? metadataPatch(node, { fontSize: command.value })
        : node;
    case "config":
      return applyNodeConfigPatch(node, command.patch);
    case "select-variant":
      return selectVariant(node, command.variantId);
    case "remove-variant":
      return removeVariant(node, command.variantId);
    case "resize": {
      if (
        ![command.width, command.height].every(
          (value) => Number.isFinite(value) && value > 0,
        )
      )
        return node;
      const position = command.position ?? node.position;
      if (![position.x, position.y].every(Number.isFinite)) return node;
      return node.width === command.width &&
        node.height === command.height &&
        node.position.x === position.x &&
        node.position.y === position.y
        ? node
        : {
            ...node,
            width: command.width,
            height: command.height,
            position: { ...position },
          };
    }
    case "toggle-free-resize": {
      const freeResize = !node.metadata?.freeResize;
      const updated = metadataPatch(node, { freeResize });
      if (freeResize || node.type !== CanvasNodeType.Image) return updated;
      const ratio =
        (node.metadata?.naturalWidth || node.width) /
        (node.metadata?.naturalHeight || node.height || 1);
      const height = node.width / ratio;
      return Number.isFinite(height) && height > 0
        ? {
            ...updated,
            height,
            position: {
              x: node.position.x,
              y: node.position.y + (node.height - height) / 2,
            },
          }
        : updated;
    }
  }
}

/** Preserve identity for no-ops so history and persistence don't record false edits. */
export function applyCanvasNodeCommand(
  nodes: CanvasNodeData[],
  command: CanvasNodeCommand,
): CanvasNodeData[] {
  const index = nodes.findIndex((node) => node.id === command.nodeId);
  if (index < 0) return nodes;
  const replacement = editNode(nodes[index], command);
  if (replacement === nodes[index]) return nodes;
  const next = nodes.slice();
  next[index] = replacement;
  return next;
}
