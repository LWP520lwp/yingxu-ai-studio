import type { CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";

export const VIEWPORT_LIMITS = { minScale: 0.05, maxScale: 5 } as const;

export function clampScale(scale: number) {
    return Math.min(VIEWPORT_LIMITS.maxScale, Math.max(VIEWPORT_LIMITS.minScale, Number.isFinite(scale) ? scale : 1));
}

export function worldPoint(viewport: ViewportTransform, screen: Position): Position {
    return { x: (screen.x - viewport.x) / viewport.k, y: (screen.y - viewport.y) / viewport.k };
}

export function screenPoint(viewport: ViewportTransform, world: Position): Position {
    return { x: world.x * viewport.k + viewport.x, y: world.y * viewport.k + viewport.y };
}

export function panViewport(viewport: ViewportTransform, dx: number, dy: number): ViewportTransform {
    return { x: viewport.x + dx, y: viewport.y + dy, k: viewport.k };
}

export function zoomViewportAt(viewport: ViewportTransform, screen: Position, wheelDelta: number): ViewportTransform {
    const nextScale = clampScale(viewport.k * Math.pow(1.1, -wheelDelta / 100));
    const anchor = worldPoint(viewport, screen);
    return { x: screen.x - anchor.x * nextScale, y: screen.y - anchor.y * nextScale, k: nextScale };
}

export function connectionCurve(from: CanvasNodeData, to: CanvasNodeData) {
    const start = { x: from.position.x + from.width, y: from.position.y + from.height / 2 };
    const end = { x: to.position.x, y: to.position.y + to.height / 2 };
    const distance = Math.abs(end.x - start.x);
    const bend = Math.max(50, distance * 0.5);
    return { start, end, path: `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}` };
}

export function activeConnectionCurve(node: CanvasNodeData, handleType: "source" | "target", pointer: Position, target?: CanvasNodeData) {
    const source = handleType === "source" ? node : target;
    const destination = handleType === "source" ? target : node;
    const start = source ? { x: source.position.x + source.width, y: source.position.y + source.height / 2 } : pointer;
    const end = destination ? { x: destination.position.x, y: destination.position.y + destination.height / 2 } : pointer;
    if (handleType === "target" && !target) return { start: pointer, end: { x: node.position.x, y: node.position.y + node.height / 2 }, path: `M ${pointer.x} ${pointer.y} L ${node.position.x} ${node.position.y + node.height / 2}` };
    if (handleType === "source" && !target) return { start: { x: node.position.x + node.width, y: node.position.y + node.height / 2 }, end: pointer, path: `M ${node.position.x + node.width} ${node.position.y + node.height / 2} L ${pointer.x} ${pointer.y}` };
    const distance = Math.abs(end.x - start.x);
    const bend = Math.max(40, distance * 0.5);
    return { start, end, path: `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}` };
}
