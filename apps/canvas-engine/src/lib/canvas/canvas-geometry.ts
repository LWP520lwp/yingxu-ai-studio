import type { CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";

export const VIEWPORT_LIMITS = { minScale: 0.05, maxScale: 5 } as const;

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const coordinate = (viewport: ViewportTransform) => ({ x: finite(viewport.x), y: finite(viewport.y) });

export function clampScale(scale: number) {
    return Math.min(VIEWPORT_LIMITS.maxScale, Math.max(VIEWPORT_LIMITS.minScale, finite(scale, 1)));
}

export function worldPoint(viewport: ViewportTransform, screen: Position): Position {
    const offset = coordinate(viewport);
    const scale = clampScale(viewport.k);
    return { x: (finite(screen.x) - offset.x) / scale, y: (finite(screen.y) - offset.y) / scale };
}

export function screenPoint(viewport: ViewportTransform, world: Position): Position {
    const offset = coordinate(viewport);
    const scale = clampScale(viewport.k);
    return { x: finite(world.x) * scale + offset.x, y: finite(world.y) * scale + offset.y };
}

export function panViewport(viewport: ViewportTransform, dx: number, dy: number): ViewportTransform {
    const offset = coordinate(viewport);
    return { x: offset.x + finite(dx), y: offset.y + finite(dy), k: clampScale(viewport.k) };
}

export function zoomViewportAt(viewport: ViewportTransform, screen: Position, wheelDelta: number): ViewportTransform {
    const anchor = { x: finite(screen.x), y: finite(screen.y) };
    const nextScale = clampScale(clampScale(viewport.k) * Math.pow(1.1, -finite(wheelDelta) / 100));
    const world = worldPoint(viewport, anchor);
    return { x: anchor.x - world.x * nextScale, y: anchor.y - world.y * nextScale, k: nextScale };
}

function centerX(node: CanvasNodeData) {
    return node.position.x + node.width / 2;
}

function port(node: CanvasNodeData, side: "left" | "right"): Position {
    return { x: node.position.x + (side === "right" ? node.width : 0), y: node.position.y + node.height / 2 };
}

function pointsBetween(from: CanvasNodeData, to: CanvasNodeData) {
    const direction = centerX(to) >= centerX(from) ? 1 : -1;
    return {
        start: port(from, direction > 0 ? "right" : "left"),
        end: port(to, direction > 0 ? "left" : "right"),
    };
}

function curvePath(start: Position, end: Position, minimumBend: number) {
    const direction = end.x >= start.x ? 1 : -1;
    const bend = Math.max(minimumBend, Math.abs(end.x - start.x) * 0.5);
    const control1 = { x: start.x + direction * bend, y: start.y };
    const control2 = { x: end.x - direction * bend, y: end.y };
    return { control1, control2, path: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}` };
}

export function connectionCurve(from: CanvasNodeData, to: CanvasNodeData) {
    const { start, end } = pointsBetween(from, to);
    return { start, end, ...curvePath(start, end, 50) };
}

function sideFacing(node: CanvasNodeData, point: Position) {
    return point.x >= centerX(node) ? "right" : "left";
}

export function activeConnectionCurve(node: CanvasNodeData, handleType: "source" | "target", pointer: Position, target?: CanvasNodeData) {
    if (target) {
        const { start, end } = handleType === "source" ? pointsBetween(node, target) : pointsBetween(target, node);
        return { start, end, ...curvePath(start, end, 40) };
    }

    const safePointer = { x: finite(pointer.x), y: finite(pointer.y) };
    if (handleType === "source") {
        const start = port(node, sideFacing(node, safePointer));
        return { start, end: safePointer, path: `M ${start.x} ${start.y} L ${safePointer.x} ${safePointer.y}` };
    }

    const end = port(node, sideFacing(node, safePointer));
    return { start: safePointer, end, path: `M ${safePointer.x} ${safePointer.y} L ${end.x} ${end.y}` };
}
