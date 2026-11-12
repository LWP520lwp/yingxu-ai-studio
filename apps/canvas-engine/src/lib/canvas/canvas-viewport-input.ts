import type { PointerEvent as ReactPointerEvent } from "react";

import { panViewport, zoomViewportAt } from "@/lib/canvas/canvas-geometry";
import type { Position, ViewportTransform } from "@/types/canvas";

const BLOCKED_SURFACES = ".ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown";

export function isCanvasInputBlocked(target: EventTarget | null) {
    return typeof Element !== "undefined" && target instanceof Element && Boolean(target.closest(`[data-canvas-no-zoom],${BLOCKED_SURFACES}`));
}

export function isEditableCanvasTarget(target: EventTarget | null) {
    if (typeof Element === "undefined" || !(target instanceof Element)) return false;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || Boolean(target.closest("[contenteditable='true']"));
}

export function isCanvasBackgroundTarget(target: EventTarget | null) {
    return !(typeof Element !== "undefined" && target instanceof Element && target.closest("[data-node-id],[data-connection-id]"));
}

export function chooseCanvasTool(tool: "select" | "pan", event: Pick<ReactPointerEvent, "button" | "ctrlKey" | "shiftKey">, spacePressed: boolean) {
    const activeTool = spacePressed ? "pan" : event.ctrlKey || event.shiftKey ? "select" : tool;
    return { activeTool, shouldPan: event.button === 1 || (event.button === 0 && activeTool === "pan") } as const;
}

export function zoomViewportFromWheel(viewport: ViewportTransform, screen: Position, wheelDelta: number) {
    return zoomViewportAt(viewport, screen, wheelDelta);
}

export function panViewportFromPointer(initial: ViewportTransform, dx: number, dy: number, scale: number) {
    return panViewport({ ...initial, k: scale }, dx, dy);
}

export function requestFrame(callback: () => void, frame: number | null) {
    if (frame !== null) return frame;
    return requestAnimationFrame(callback);
}
