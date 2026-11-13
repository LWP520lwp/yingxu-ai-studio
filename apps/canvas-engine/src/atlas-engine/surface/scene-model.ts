import type { CanvasResourceReference } from "@/atlas-engine/model/resource-references";
import type { CanvasNodeData, SelectionBox } from "@/types/canvas";
import type {
  AtlasNodeCardProps,
  AtlasReferenceMode,
} from "./atlas-node-card-contracts";

export type AtlasSceneSelection = {
  nodes: ReadonlySet<string>;
  focused: string | null;
  relatedNodes: ReadonlySet<string>;
  relatedEdges: ReadonlySet<string>;
  edge: string | null;
};

export type AtlasScenePresentation = {
  scale: number;
  panelWidth: number;
  panelNode: string | null;
  resizing: boolean;
  selecting: boolean;
  imageInfo: boolean;
  dropGroup: string | null;
  expanded: ReadonlySet<string>;
  childCounts: ReadonlyMap<string, number>;
  mentions: ReadonlyMap<string, CanvasResourceReference[]>;
};

export type AtlasSceneReferences = {
  owner: string | null;
  connected: ReadonlySet<string>;
  accepts: (node: CanvasNodeData) => boolean;
};

export type AtlasSceneWire = { source: string; target: string | null } | null;

const emptyReferences: CanvasResourceReference[] = [];

function referenceMode(
  node: CanvasNodeData,
  references: AtlasSceneReferences,
): AtlasReferenceMode | undefined {
  if (!references.owner) return undefined;
  if (references.owner === node.id) return "target";
  return references.connected.has(node.id) || !references.accepts(node)
    ? "disabled"
    : "available";
}

export function atlasSceneNodeView(
  node: CanvasNodeData,
  selection: AtlasSceneSelection,
  presentation: AtlasScenePresentation,
  references: AtlasSceneReferences,
  wire: AtlasSceneWire,
  panelAllowed: boolean,
) {
  return {
    data: node,
    scale: presentation.scale,
    panelWidth: presentation.panelWidth,
    isSelected: selection.nodes.has(node.id),
    isRelated: selection.relatedNodes.has(node.id),
    isFocusRelated: selection.focused === node.id,
    isConnectionTarget: wire?.target === node.id,
    isConnecting: wire !== null,
    referenceSelectionState: referenceMode(node, references),
    showPanel:
      panelAllowed &&
      !presentation.resizing &&
      !presentation.selecting &&
      presentation.panelNode === node.id,
    showImageInfo: presentation.imageInfo,
    isGroupDropTarget: presentation.dropGroup === node.id,
    groupChildCount: presentation.childCounts.get(node.id) ?? 0,
    batchExpanded: presentation.expanded.has(node.id),
    mentionReferences: presentation.mentions.get(node.id) ?? emptyReferences,
  } satisfies Partial<AtlasNodeCardProps>;
}

export function atlasMarqueeBounds(box: SelectionBox) {
  const x = Math.min(box.startWorldX, box.currentWorldX);
  const y = Math.min(box.startWorldY, box.currentWorldY);
  return {
    left: x,
    top: y,
    width: Math.abs(box.currentWorldX - box.startWorldX),
    height: Math.abs(box.currentWorldY - box.startWorldY),
  };
}
