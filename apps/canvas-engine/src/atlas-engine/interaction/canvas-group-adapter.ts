import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type ViewportTransform,
} from "@/types/canvas";
import {
  atlasGroupFrame,
  atlasNodeBounds,
  canAtlasGroupSelection,
  canAtlasUngroupSelection,
  collectAtlasGroupMembers,
  fitAtlasViewportForNode,
  groupAtlasSelection,
  ungroupAtlasSelection,
  type AtlasGeometryNode,
  type AtlasViewportFrame,
} from "./group-model";

const GROUP_CONTENT_INSET = 24;

export function canvasNodeBounds(nodes: readonly CanvasNodeData[]) {
  return atlasNodeBounds(nodes.map(toAtlasGeometryNode));
}

export function findCanvasGroupDropTarget(
  movedIds: ReadonlySet<string>,
  nodes: readonly CanvasNodeData[],
): CanvasNodeData | null {
  if (
    nodes.some(
      (node) => movedIds.has(node.id) && node.type === CanvasNodeType.Group,
    )
  )
    return null;
  const moved = nodes.filter(
    (node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group,
  );
  if (!moved.length) return null;

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const candidate = nodes[index];
    if (candidate.type !== CanvasNodeType.Group || movedIds.has(candidate.id))
      continue;
    const bounds = atlasNodeBounds([toAtlasGeometryNode(candidate)]);
    const containsMovedCenter = moved.some((node) => {
      const frame = atlasNodeBounds([toAtlasGeometryNode(node)]);
      const centerX = (frame.left + frame.right) / 2;
      const centerY = (frame.top + frame.bottom) / 2;
      return (
        centerX >= bounds.left &&
        centerX <= bounds.right &&
        centerY >= bounds.top &&
        centerY <= bounds.bottom
      );
    });
    if (containsMovedCenter) return candidate;
  }
  return null;
}

export function containingCanvasGroupId(
  node: CanvasNodeData,
  nodes: readonly CanvasNodeData[],
): string | undefined {
  const frame = atlasNodeBounds([toAtlasGeometryNode(node)]);
  const centerX = (frame.left + frame.right) / 2;
  const centerY = (frame.top + frame.bottom) / 2;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const candidate = nodes[index];
    if (candidate.type !== CanvasNodeType.Group || candidate.id === node.id)
      continue;
    const bounds = atlasNodeBounds([toAtlasGeometryNode(candidate)]);
    if (
      centerX >= bounds.left &&
      centerX <= bounds.right &&
      centerY >= bounds.top &&
      centerY <= bounds.bottom
    )
      return candidate.id;
  }
  return undefined;
}

export function snapCanvasNodesIntoGroup(
  movedIds: ReadonlySet<string>,
  nodes: CanvasNodeData[],
  group: CanvasNodeData,
): CanvasNodeData[] {
  const moved = nodes.filter(
    (node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group,
  );
  if (!moved.length) return nodes;

  const content = canvasNodeBounds(moved);
  const frame = toAtlasGeometryNode(group);
  const innerLeft = frame.position.x + GROUP_CONTENT_INSET;
  const innerRight = frame.position.x + frame.width - GROUP_CONTENT_INSET;
  const innerTop = frame.position.y + GROUP_CONTENT_INSET;
  const innerBottom = frame.position.y + frame.height - GROUP_CONTENT_INSET;
  const dx =
    content.right - content.left > innerRight - innerLeft
      ? innerLeft - content.left
      : content.left < innerLeft
        ? innerLeft - content.left
        : content.right > innerRight
          ? innerRight - content.right
          : 0;
  const dy =
    content.bottom - content.top > innerBottom - innerTop
      ? innerTop - content.top
      : content.top < innerTop
        ? innerTop - content.top
        : content.bottom > innerBottom
          ? innerBottom - content.bottom
          : 0;

  let changed = false;
  const result = nodes.map((node) => {
    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group)
      return node;
    const position = {
      x: finiteCoordinate(node.position.x) + dx,
      y: finiteCoordinate(node.position.y) + dy,
    };
    if (node.metadata?.groupId === group.id && dx === 0 && dy === 0)
      return node;
    changed = true;
    return {
      ...node,
      position,
      metadata: { ...node.metadata, groupId: group.id },
    };
  });
  return changed ? result : nodes;
}

export function canvasGroupFrame(nodes: readonly CanvasNodeData[]) {
  return atlasGroupFrame(nodes.map(toAtlasGeometryNode));
}

export function canvasGroupMembers(
  selectedIds: ReadonlySet<string>,
  nodes: readonly CanvasNodeData[],
): CanvasNodeData[] {
  const memberIds = new Set(
    collectAtlasGroupMembers(selectedIds, nodes.map(toAtlasGeometryNode)).map(
      (node) => node.id,
    ),
  );
  return nodes.filter((node) => memberIds.has(node.id));
}

export function canCanvasGroupSelection(
  selectedIds: ReadonlySet<string>,
  nodes: readonly CanvasNodeData[],
) {
  return canAtlasGroupSelection(selectedIds, nodes.map(toAtlasGeometryNode));
}

export function canCanvasUngroupSelection(
  selectedIds: ReadonlySet<string>,
  nodes: readonly CanvasNodeData[],
) {
  return canAtlasUngroupSelection(selectedIds, nodes.map(toAtlasGeometryNode));
}

export function applyAtlasGroupSelection(
  selectedIds: ReadonlySet<string>,
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
  group: CanvasNodeData,
) {
  const result = groupAtlasSelection(
    selectedIds,
    nodes.map(toAtlasGeometryNode),
    toAtlasGeometryNode(group),
  );
  if (!result) return null;
  return {
    nodes: mergeCanvasNodes(result.nodes, nodes, group),
    connections: keepCanvasConnections(connections, result.removedNodeIds),
    selectedIds: [...result.selectedIds],
  };
}

export function applyAtlasUngroupSelection(
  selectedIds: ReadonlySet<string>,
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
) {
  const result = ungroupAtlasSelection(
    selectedIds,
    nodes.map(toAtlasGeometryNode),
  );
  if (!result) return null;
  return {
    nodes: mergeCanvasNodes(result.nodes, nodes),
    connections: keepCanvasConnections(connections, result.removedNodeIds),
    selectedIds: [...result.selectedIds],
  };
}

export function focusCanvasViewportForNode(
  node: Pick<CanvasNodeData, "position" | "width" | "height">,
  size: Readonly<{ width: number; height: number }>,
  overlays: AtlasViewportFrame = {},
): ViewportTransform {
  const result = fitAtlasViewportForNode(
    {
      position: node.position,
      width: node.width,
      height: node.height,
    },
    size,
    overlays,
  );
  return { x: result.x, y: result.y, k: result.scale };
}

function toAtlasGeometryNode(node: CanvasNodeData): AtlasGeometryNode {
  return {
    id: node.id,
    kind: node.type === CanvasNodeType.Group ? "group" : "node",
    position: node.position,
    width: node.width,
    height: node.height,
    groupId: node.metadata?.groupId,
  };
}

function mergeCanvasNodes(
  updated: readonly AtlasGeometryNode[],
  original: readonly CanvasNodeData[],
  newGroup?: CanvasNodeData,
): CanvasNodeData[] {
  const originalById = new Map(original.map((node) => [node.id, node]));
  if (newGroup) originalById.set(newGroup.id, newGroup);
  return updated.flatMap((item) => {
    const source = originalById.get(item.id);
    if (!source) return [];
    if (source.metadata?.groupId === item.groupId) return [source];
    return [
      {
        ...source,
        metadata: { ...source.metadata, groupId: item.groupId },
      },
    ];
  });
}

function keepCanvasConnections(
  connections: readonly CanvasConnection[],
  removedNodeIds: ReadonlySet<string>,
): CanvasConnection[] {
  return connections.filter(
    (edge) =>
      !removedNodeIds.has(edge.fromNodeId) &&
      !removedNodeIds.has(edge.toNodeId),
  );
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? Math.max(-1e12, Math.min(1e12, value)) : 0;
}
