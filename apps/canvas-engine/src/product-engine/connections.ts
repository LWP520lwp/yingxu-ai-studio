import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { Point } from "./document";

export type ConnectionSide = "source" | "target";
export type ConnectionStart = { nodeId: string; handleType: ConnectionSide };
export type NormalizedConnection = { fromNodeId: string; toNodeId: string };
export type ConnectionDropTarget = { nodeId: string | null; isNearNode: boolean };

export const CONNECTION_HANDLE_HIT_RADIUS = 40;
export const CONNECTION_NODE_HIT_PADDING = 32;

export function connectionTargetAnchor(node: CanvasNodeData, start: ConnectionStart): Point {
  const left = Number.isFinite(node.position.x) ? node.position.x : 0;
  const top = Number.isFinite(node.position.y) ? node.position.y : 0;
  const width = Number.isFinite(node.width) ? Math.max(0, node.width) : 0;
  const height = Number.isFinite(node.height) ? Math.max(0, node.height) : 0;
  return {
    x: start.handleType === "source" ? left : left + width,
    y: top + height / 2,
  };
}

/** Resolves the final edge direction, including the input/output rules for config nodes. */
export function normalizeProductConnection(
  firstNodeId: string,
  secondNodeId: string,
  nodes: readonly CanvasNodeData[],
  firstHandleType: ConnectionSide,
): NormalizedConnection | null {
  const first = nodes.find((node) => node.id === firstNodeId);
  const second = nodes.find((node) => node.id === secondNodeId);
  if (!first || !second || first.id === second.id || second.type === CanvasNodeType.Group) return null;
  if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
  if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
  if (first.type === CanvasNodeType.Config && firstHandleType === "target") {
    return { fromNodeId: second.id, toNodeId: first.id };
  }
  return { fromNodeId: first.id, toNodeId: second.id };
}

function inside(point: Point, node: CanvasNodeData, padding: number): boolean {
  return point.x >= node.position.x - padding
    && point.x <= node.position.x + node.width + padding
    && point.y >= node.position.y - padding
    && point.y <= node.position.y + node.height + padding;
}

/** Finds the topmost eligible target and keeps invalid nearby drops distinguishable from empty space. */
export function findConnectionDropTarget(
  point: Point,
  scale: number,
  start: ConnectionStart,
  nodes: readonly CanvasNodeData[],
  padding = CONNECTION_NODE_HIT_PADDING,
  handleRadius = CONNECTION_HANDLE_HIT_RADIUS,
): ConnectionDropTarget {
  if (![point.x, point.y].every(Number.isFinite)) return { nodeId: null, isNearNode: false };
  const safeScale = Number.isFinite(scale) ? Math.max(scale, 0.05) : 0.05;
  const worldPadding = Math.max(0, padding) / safeScale;
  const worldRadius = Math.max(0, handleRadius) / safeScale;
  let isNearNode = false;
  let targetNodeId: string | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const anchor = connectionTargetAnchor(node, start);
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const hitsHandle = dx * dx + dy * dy <= worldRadius * worldRadius;
    const hitsInside = inside(point, node, 0);
    const hitsExpanded = inside(point, node, worldPadding);
    if (!hitsHandle && !hitsInside && !hitsExpanded) continue;

    isNearNode = true;
    if (node.id === start.nodeId || !normalizeProductConnection(start.nodeId, node.id, nodes, start.handleType)) continue;
    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
    if (priority < bestPriority) {
      targetNodeId = node.id;
      bestPriority = priority;
    }
  }

  return { nodeId: targetNodeId, isNearNode };
}
