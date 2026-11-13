import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type AtlasNodePolicy = {
  hasSourceHandle?: boolean;
  transparentBackground?: boolean;
  interactionToggle?: boolean;
  forceInteractive?: (node: CanvasNodeData) => boolean;
  keepAspectRatio?: (node: CanvasNodeData) => boolean;
};

export type AtlasNodeCardState = {
  isGroup: boolean;
  hasImage: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  batchCount: number;
  isBatch: boolean;
  isActive: boolean;
  contentInteractive: boolean;
  keepAspectRatio: boolean;
  transparentBackground: boolean;
  showImageInfo: boolean;
  showTitle: boolean;
  showReferenceOverlay: boolean;
  showFooterFade: boolean;
  showConnectionHandles: boolean;
  connectionHandlesVisible: boolean;
  showSourceHandle: boolean;
  highlightGroupDropTarget: boolean;
};

export function atlasPrimaryImage(node: CanvasNodeData) {
  const images = node.metadata?.images ?? [];
  return images.find((image) => image.id === node.metadata?.primaryImageId) ?? images[0];
}

export function atlasPrimaryText(node: CanvasNodeData) {
  const texts = node.metadata?.texts ?? [];
  return texts.find((text) => text.id === node.metadata?.primaryTextId) ?? texts[0];
}

export function deriveAtlasNodeCardState(input: {
  node: CanvasNodeData;
  policy?: AtlasNodePolicy;
  selected: boolean;
  focusRelated: boolean;
  connectionTarget: boolean;
  connecting: boolean;
  hovered: boolean;
  editingTitle: boolean;
  groupDropTarget: boolean;
  referenceMode?: "target" | "disabled" | "available";
  showImageInfo: boolean;
}): AtlasNodeCardState {
  const { node, policy } = input;
  const isGroup = node.type === CanvasNodeType.Group;
  const hasImage = node.type === CanvasNodeType.Image && Boolean(atlasPrimaryImage(node)?.content || node.metadata?.content);
  const hasVideo = node.type === CanvasNodeType.Video && Boolean(node.metadata?.content);
  const hasAudio = node.type === CanvasNodeType.Audio && Boolean(node.metadata?.content);
  const batchCount = node.type === CanvasNodeType.Image
    ? (node.metadata?.images?.length ?? 0)
    : node.type === CanvasNodeType.Text
      ? (node.metadata?.texts?.length ?? 0)
      : 0;
  const supportsInteraction = Boolean(policy?.interactionToggle);
  const forcedInteractive = supportsInteraction ? Boolean(policy?.forceInteractive?.(node)) : false;
  const isActive = input.connectionTarget || input.selected || input.focusRelated;
  const hasReferenceMode = Boolean(input.referenceMode);

  return {
    isGroup,
    hasImage,
    hasVideo,
    hasAudio,
    batchCount,
    isBatch: batchCount > 1,
    isActive,
    contentInteractive: !supportsInteraction || forcedInteractive || !node.metadata?.content || Boolean(node.metadata.interactive),
    keepAspectRatio:
      (node.type === CanvasNodeType.Image && !node.metadata?.freeResize) ||
      node.type === CanvasNodeType.Video || Boolean(policy?.keepAspectRatio?.(node)),
    transparentBackground: Boolean(policy?.transparentBackground),
    showImageInfo: input.showImageInfo && hasImage,
    showTitle: !hasReferenceMode && (input.selected || input.hovered || input.editingTitle),
    showReferenceOverlay: hasReferenceMode && (input.referenceMode !== "available" || input.hovered),
    showFooterFade: !isGroup && !hasImage && !hasVideo && !hasAudio,
    showConnectionHandles: !hasReferenceMode && !isGroup,
    connectionHandlesVisible: input.hovered || input.selected || input.connecting,
    showSourceHandle: (policy?.hasSourceHandle ?? true) && node.type !== CanvasNodeType.Config && !hasReferenceMode,
    highlightGroupDropTarget: isGroup && input.groupDropTarget,
  };
}

export function resolveAtlasResize(input: {
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  start: { x: number; y: number };
  pointer: { x: number; y: number };
  position: { x: number; y: number };
  size: { width: number; height: number };
  scale: number;
  keepRatio: boolean;
  ratio: number;
}) {
  const scale = Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1;
  const dx = (input.pointer.x - input.start.x) / scale;
  const dy = (input.pointer.y - input.start.y) / scale;
  const left = input.corner.endsWith("left");
  const top = input.corner.startsWith("top");
  let width = Math.max(96, input.size.width + (left ? -dx : dx));
  let height = Math.max(80, input.size.height + (top ? -dy : dy));

  if (input.keepRatio && input.ratio > 0 && Number.isFinite(input.ratio)) {
    const widthChange = Math.abs(width - input.size.width) / Math.max(input.size.width, 1);
    const heightChange = Math.abs(height - input.size.height) / Math.max(input.size.height, 1);
    if (widthChange >= heightChange) height = Math.max(80, width / input.ratio);
    else width = Math.max(96, height * input.ratio);
  }

  return {
    width,
    height,
    position: {
      x: left ? input.position.x + input.size.width - width : input.position.x,
      y: top ? input.position.y + input.size.height - height : input.position.y,
    },
  };
}
