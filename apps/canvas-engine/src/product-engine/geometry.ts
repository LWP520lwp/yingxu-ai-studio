import type { Point, ProductNode, ProductViewport, Rect } from "./document";

export type CanvasPort = "left" | "right";

export function screenToWorld(point: Point, viewport: ProductViewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function worldToScreen(point: Point, viewport: ProductViewport): Point {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

export function zoomAt(
  viewport: ProductViewport,
  anchor: Point,
  factor: number,
  limits = { min: 0.05, max: 5 },
): ProductViewport {
  if (![viewport.x, viewport.y, viewport.scale, anchor.x, anchor.y, factor].every(Number.isFinite) || factor <= 0)
    return viewport;
  const scale = Math.max(limits.min, Math.min(limits.max, viewport.scale * factor));
  const ratio = scale / viewport.scale;
  return {
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
    scale,
  };
}

export function panBy(viewport: ProductViewport, delta: Point): ProductViewport {
  if (![viewport.x, viewport.y, delta.x, delta.y].every(Number.isFinite)) return viewport;
  return { ...viewport, x: viewport.x + delta.x, y: viewport.y + delta.y };
}

export function rectangleFor(node: ProductNode): Rect {
  return { ...node.frame };
}

export function unionBounds(rectangles: readonly Rect[]): Rect {
  if (!rectangles.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...rectangles.map((rect) => rect.x));
  const top = Math.min(...rectangles.map((rect) => rect.y));
  const right = Math.max(...rectangles.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rectangles.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function findNodeAt(
  point: Point,
  nodes: readonly ProductNode[],
): ProductNode | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const { x, y, width, height } = node.frame;
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height)
      return node;
  }
  return null;
}

export function portPosition(node: ProductNode, port: CanvasPort): Point {
  return {
    x: node.frame.x + (port === "right" ? node.frame.width : 0),
    y: node.frame.y + node.frame.height / 2,
  };
}

export function connectionCurve(from: Point, to: Point): string {
  const reach = Math.max(48, Math.abs(to.x - from.x) * 0.45);
  const direction = to.x >= from.x ? 1 : -1;
  return `M ${from.x} ${from.y} C ${from.x + reach * direction} ${from.y}, ${to.x - reach * direction} ${to.y}, ${to.x} ${to.y}`;
}

export function edgeCurve(from: ProductNode, to: ProductNode) {
  const forward = to.frame.x + to.frame.width / 2 >= from.frame.x + from.frame.width / 2;
  const start = portPosition(from, forward ? "right" : "left");
  const end = portPosition(to, forward ? "left" : "right");
  return { start, end, path: connectionCurve(start, end) };
}

export function previewEdgeCurve(
  node: ProductNode,
  side: "source" | "target",
  pointer: Point,
  target?: ProductNode,
) {
  if (target) return side === "source" ? edgeCurve(node, target) : edgeCurve(target, node);
  const right = pointer.x >= node.frame.x + node.frame.width / 2;
  const anchor = portPosition(node, right ? "right" : "left");
  const start = side === "source" ? anchor : pointer;
  const end = side === "source" ? pointer : anchor;
  return { start, end, path: `M ${start.x} ${start.y} L ${end.x} ${end.y}` };
}
