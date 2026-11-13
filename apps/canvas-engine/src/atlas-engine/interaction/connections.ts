import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";

export type ConnectionSide = "source" | "target";
export type ConnectionStart = { nodeId: string; handleType: ConnectionSide };
export type NormalizedConnection = { fromNodeId: string; toNodeId: string };
export type ConnectionDropTarget = { nodeId: string | null; isNearNode: boolean };

export const CONNECTION_HANDLE_HIT_RADIUS = 40;
export const CONNECTION_NODE_HIT_PADDING = 32;

export function connectionAnchor(node: CanvasNodeData, handleType: ConnectionSide): Position {
  const left = finiteOr(node.position.x, 0);
  const top = finiteOr(node.position.y, 0);
  const width = Math.max(0, finiteOr(node.width, 0));
  const height = Math.max(0, finiteOr(node.height, 0));
  return {
    x: handleType === "source" ? left : left + width,
    y: top + height / 2,
  };
}

export function connectionTargetAnchor(node: CanvasNodeData, start: ConnectionStart): Position {
  return connectionAnchor(node, start.handleType);
}

export function resolveConnection(
  firstNodeId: string,
  secondNodeId: string,
  nodes: readonly CanvasNodeData[],
  firstHandle: ConnectionSide,
): NormalizedConnection | null {
  const first = nodes.find((node) => node.id === firstNodeId);
  const second = nodes.find((node) => node.id === secondNodeId);
  if (!first || !second || first.id === second.id || second.type === CanvasNodeType.Group) return null;
  if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
  if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
  if (first.type === CanvasNodeType.Config && firstHandle === "target") {
    return { fromNodeId: second.id, toNodeId: first.id };
  }
  return { fromNodeId: first.id, toNodeId: second.id };
}

export const normalizeProductConnection = resolveConnection;

function contains(point: Position, node: CanvasNodeData, padding: number): boolean {
  const x = finiteOr(node.position.x, 0);
  const y = finiteOr(node.position.y, 0);
  const right = x + Math.max(0, finiteOr(node.width, 0));
  const bottom = y + Math.max(0, finiteOr(node.height, 0));
  return point.x >= x - padding && point.x <= right + padding
    && point.y >= y - padding && point.y <= bottom + padding;
}

export function resolveConnectionDrop(
  point: Position,
  scale: number,
  start: ConnectionStart,
  nodes: readonly CanvasNodeData[],
  padding = CONNECTION_NODE_HIT_PADDING,
  handleRadius = CONNECTION_HANDLE_HIT_RADIUS,
): ConnectionDropTarget {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { nodeId: null, isNearNode: false };
  }

  const safeScale = Number.isFinite(scale) ? Math.max(scale, 0.05) : 0.05;
  const worldPadding = Math.max(0, padding) / safeScale;
  const worldRadius = Math.max(0, handleRadius) / safeScale;
  let isNearNode = false;
  let bestNodeId: string | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const anchor = connectionAnchor(node, start.handleType);
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const hitsPort = dx * dx + dy * dy <= worldRadius * worldRadius;
    const hitsBody = contains(point, node, 0);
    const hitsHalo = contains(point, node, worldPadding);
    if (!hitsPort && !hitsBody && !hitsHalo) continue;

    isNearNode = true;
    if (node.id === start.nodeId || !resolveConnection(start.nodeId, node.id, nodes, start.handleType)) continue;
    const priority = hitsBody ? 0 : hitsPort ? 1 : 2;
    if (priority < bestPriority) {
      bestNodeId = node.id;
      bestPriority = priority;
    }
  }

  return { nodeId: bestNodeId, isNearNode };
}

export const findConnectionDropTarget = resolveConnectionDrop;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
