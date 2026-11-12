import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

import { primaryImageSlot } from "./slot-view-model";

type NodeBehaviorDefinition = Pick<
  CanvasNodeDefinition,
  | "hasSourceHandle"
  | "interactionToggle"
  | "forceInteractive"
  | "keepAspectRatio"
  | "transparentBackground"
>;

export type CanvasNodeViewModelInput = {
  node: CanvasNodeData;
  definition?: NodeBehaviorDefinition;
  isSelected: boolean;
  isFocusRelated: boolean;
  isConnectionTarget: boolean;
  isConnecting: boolean;
  isHovered: boolean;
  isEditingTitle: boolean;
  isGroupDropTarget: boolean;
  hasReferenceSelection: boolean;
  referenceSelectionAvailable: boolean;
  showImageInfo: boolean;
};

export type CanvasNodeViewModel = {
  hasImageContent: boolean;
  hasVideoContent: boolean;
  hasAudioContent: boolean;
  isGroup: boolean;
  batchCount: number;
  isBatchRoot: boolean;
  contentInteractive: boolean;
  transparentBackground: boolean;
  isActive: boolean;
  keepAspectRatio: boolean;
  showImageInfo: boolean;
  showTitle: boolean;
  showReferenceOverlay: boolean;
  showFooterFade: boolean;
  showConnectionHandles: boolean;
  connectionHandlesVisible: boolean;
  showSourceHandle: boolean;
  highlightGroupDropTarget: boolean;
};

export function buildCanvasNodeViewModel({
  node,
  definition,
  isSelected,
  isFocusRelated,
  isConnectionTarget,
  isConnecting,
  isHovered,
  isEditingTitle,
  isGroupDropTarget,
  hasReferenceSelection,
  referenceSelectionAvailable,
  showImageInfo,
}: CanvasNodeViewModelInput): CanvasNodeViewModel {
  const isGroup = node.type === CanvasNodeType.Group;
  const hasImageContent =
    node.type === CanvasNodeType.Image &&
    Boolean(primaryImageSlot(node).content);
  const hasVideoContent =
    node.type === CanvasNodeType.Video && Boolean(node.metadata?.content);
  const hasAudioContent =
    node.type === CanvasNodeType.Audio && Boolean(node.metadata?.content);
  const batchCount =
    node.type === CanvasNodeType.Image
      ? (node.metadata?.images?.length ?? 0)
      : node.type === CanvasNodeType.Text
        ? (node.metadata?.texts?.length ?? 0)
        : 0;
  const supportsInteractionToggle = Boolean(definition?.interactionToggle);
  const forceInteractive = supportsInteractionToggle
    ? Boolean(definition?.forceInteractive?.(node))
    : false;
  const isActive = isConnectionTarget || isSelected || isFocusRelated;

  return {
    hasImageContent,
    hasVideoContent,
    hasAudioContent,
    isGroup,
    batchCount,
    isBatchRoot: batchCount > 1,
    contentInteractive:
      !supportsInteractionToggle ||
      forceInteractive ||
      !node.metadata?.content ||
      Boolean(node.metadata.interactive),
    transparentBackground: Boolean(definition?.transparentBackground),
    isActive,
    keepAspectRatio:
      (node.type === CanvasNodeType.Image && !node.metadata?.freeResize) ||
      node.type === CanvasNodeType.Video ||
      Boolean(definition?.keepAspectRatio?.(node)),
    showImageInfo: showImageInfo && hasImageContent,
    showTitle:
      !hasReferenceSelection && (isSelected || isHovered || isEditingTitle),
    showReferenceOverlay:
      hasReferenceSelection && (!referenceSelectionAvailable || isHovered),
    showFooterFade:
      !isGroup && !hasImageContent && !hasVideoContent && !hasAudioContent,
    showConnectionHandles: !hasReferenceSelection && !isGroup,
    connectionHandlesVisible: isHovered || isSelected || isConnecting,
    showSourceHandle:
      (definition?.hasSourceHandle ?? true) &&
      node.type !== CanvasNodeType.Config &&
      !hasReferenceSelection,
    highlightGroupDropTarget: isGroup && isGroupDropTarget,
  };
}

export function normalizeCanvasNodeTitle(
  draft: string,
  currentTitle: string,
  fallbackTitle: string,
  maxLength = 64,
): string {
  return draft.trim().slice(0, maxLength) || currentTitle || fallbackTitle;
}

export function claimCanvasNodeTitleSettlement(session: {
  current: boolean;
}): boolean {
  if (session.current) return false;
  session.current = true;
  return true;
}
