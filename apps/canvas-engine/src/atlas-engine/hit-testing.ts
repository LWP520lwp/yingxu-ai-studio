import { nodeRect, type AtlasDocument, type AtlasEdge, type AtlasNode, type AtlasPoint, type AtlasRect } from "./model";

export function containsPoint(rect: AtlasRect, point: AtlasPoint, padding = 0): boolean {
  return point.x >= rect.x - padding && point.x <= rect.x + rect.width + padding
    && point.y >= rect.y - padding && point.y <= rect.y + rect.height + padding;
}

export function hitTestNode(nodes: readonly AtlasNode[], point: AtlasPoint, padding = 0): AtlasNode | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (containsPoint(nodeRect(nodes[index]), point, padding)) return nodes[index];
  }
  return null;
}

function center(rect: AtlasRect): AtlasPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function connectionPolyline(source: AtlasNode, target: AtlasNode): AtlasPoint[] {
  const from = nodeRect(source);
  const to = nodeRect(target);
  const start = { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = { x: to.x, y: to.y + to.height / 2 };
  const span = Math.max(32, Math.abs(end.x - start.x) * 0.45);
  return [start, { x: start.x + span, y: start.y }, { x: end.x - span, y: end.y }, end];
}

function pointSegmentDistance(point: AtlasPoint, start: AtlasPoint, end: AtlasPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

export function distanceToConnection(edge: AtlasEdge, nodes: readonly AtlasNode[], point: AtlasPoint): number {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return Infinity;
  const path = connectionPolyline(source, target);
  return Math.min(...path.slice(1).map((item, index) => pointSegmentDistance(point, path[index], item)));
}

export function hitTestConnection(document: AtlasDocument, point: AtlasPoint, tolerance = 8): AtlasEdge | null {
  for (let index = document.edges.length - 1; index >= 0; index -= 1) {
    const edge = document.edges[index];
    if (distanceToConnection(edge, document.nodes, point) <= tolerance) return edge;
  }
  return null;
}

export function worldPoint(screen: AtlasPoint, viewport: AtlasDocument["viewport"]): AtlasPoint {
  const zoom = viewport.zoom || 1;
  return { x: (screen.x - viewport.x) / zoom, y: (screen.y - viewport.y) / zoom };
}

export function screenPoint(world: AtlasPoint, viewport: AtlasDocument["viewport"]): AtlasPoint {
  return { x: world.x * viewport.zoom + viewport.x, y: world.y * viewport.zoom + viewport.y };
}
