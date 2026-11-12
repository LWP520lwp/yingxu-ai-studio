import type { AtlasEdge, AtlasNode, AtlasPoint, AtlasPort, AtlasViewport } from "./model";

export type AtlasRect = Readonly<{ x: number; y: number; width: number; height: number }>;

export function portPoint(node: AtlasNode, port: AtlasPort = "right"): AtlasPoint {
  const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
  switch (port) {
    case "top": return { x: center.x, y: node.position.y };
    case "bottom": return { x: center.x, y: node.position.y + node.height };
    case "left": return { x: node.position.x, y: center.y };
    case "right": return { x: node.position.x + node.width, y: center.y };
  }
}

function bend(from: AtlasPoint, to: AtlasPoint, fromPort: AtlasPort, toPort: AtlasPort): [AtlasPoint, AtlasPoint] {
  const distance = Math.max(48, Math.min(260, Math.abs(to.x - from.x) * 0.45 + Math.abs(to.y - from.y) * 0.2));
  const offset = (port: AtlasPort): AtlasPoint =>
    port === "left" ? { x: -distance, y: 0 } :
    port === "right" ? { x: distance, y: 0 } :
    port === "top" ? { x: 0, y: -distance } : { x: 0, y: distance };
  const a = offset(fromPort);
  const b = offset(toPort);
  return [
    { x: from.x + a.x, y: from.y + a.y },
    { x: to.x + b.x, y: to.y + b.y },
  ];
}

export function edgePath(edge: AtlasEdge, from: AtlasNode, to: AtlasNode): string {
  const fromPort = edge.fromPort ?? "right";
  const toPort = edge.toPort ?? "left";
  const start = portPoint(from, fromPort);
  const end = portPoint(to, toPort);
  const [controlA, controlB] = bend(start, end, fromPort, toPort);
  return `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`;
}

export function screenToWorld(viewport: AtlasViewport, point: AtlasPoint, origin: AtlasPoint = { x: 0, y: 0 }): AtlasPoint {
  return { x: (point.x - origin.x - viewport.x) / viewport.scale, y: (point.y - origin.y - viewport.y) / viewport.scale };
}

export function worldToScreen(viewport: AtlasViewport, point: AtlasPoint, origin: AtlasPoint = { x: 0, y: 0 }): AtlasPoint {
  return { x: origin.x + viewport.x + point.x * viewport.scale, y: origin.y + viewport.y + point.y * viewport.scale };
}

export function zoomAround(viewport: AtlasViewport, anchor: AtlasPoint, factor: number): AtlasViewport {
  const scale = Math.max(0.08, Math.min(4, viewport.scale * factor));
  const ratio = scale / viewport.scale;
  return { scale, x: anchor.x - (anchor.x - viewport.x) * ratio, y: anchor.y - (anchor.y - viewport.y) * ratio };
}

export function translateViewport(viewport: AtlasViewport, delta: AtlasPoint): AtlasViewport {
  return { ...viewport, x: viewport.x + delta.x, y: viewport.y + delta.y };
}

export function containsPoint(rect: AtlasRect, point: AtlasPoint): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function nearestPort(node: AtlasNode, point: AtlasPoint, radius = 28): AtlasPort | undefined {
  const ports: AtlasPort[] = ["top", "right", "bottom", "left"];
  let winner: AtlasPort | undefined;
  let distance = radius;
  for (const port of ports) {
    const candidate = portPoint(node, port);
    const next = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (next <= distance) { winner = port; distance = next; }
  }
  return winner;
}
