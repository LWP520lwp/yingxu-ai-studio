import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent, MouseEvent as ReactMouseEvent } from "react";

import { chooseCanvasTool, isCanvasBackgroundTarget, isCanvasInputBlocked, isEditableCanvasTarget, panViewportFromPointer, requestFrame, zoomViewportFromWheel } from "@/lib/canvas/canvas-viewport-input";
import type { ViewportTransform } from "@/types/canvas";

type ViewportInputArgs = {
    containerRef: RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    tool: "select" | "pan";
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

type PanSession = {
    active: boolean;
    startedOnBackground: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    initial: ViewportTransform;
};

const idlePan: PanSession = { active: false, startedOnBackground: false, moved: false, startX: 0, startY: 0, initial: { x: 0, y: 0, k: 1 } };

export function useCanvasViewportInput({ containerRef, viewport, tool, onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick }: ViewportInputArgs) {
    const viewportRef = useRef(viewport);
    const panRef = useRef<PanSession>(idlePan);
    const frameRef = useRef<number | null>(null);
    const pendingRef = useRef<ViewportTransform | null>(null);
    const [spacePressed, setSpacePressed] = useState(false);
    const [controlPressed, setControlPressed] = useState(false);
    const [shiftPressed, setShiftPressed] = useState(false);
    const [panning, setPanning] = useState(false);

    useEffect(() => {
        viewportRef.current = viewport;
    }, [viewport]);

    useEffect(() => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Control") setControlPressed(true);
            if (event.key === "Shift") setShiftPressed(true);
            if (event.code !== "Space" || isEditableCanvasTarget(event.target)) return;
            event.preventDefault();
            setSpacePressed(true);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                if (!isEditableCanvasTarget(event.target)) event.preventDefault();
                setSpacePressed(false);
            }
            if (event.key === "Control") setControlPressed(false);
            if (event.key === "Shift") setShiftPressed(false);
        };
        const onWindowBlur = () => {
            setSpacePressed(false);
            setControlPressed(false);
            setShiftPressed(false);
            panRef.current = { ...panRef.current, active: false };
            setPanning(false);
            document.body.style.cursor = "";
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onWindowBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onWindowBlur);
        };
    }, []);

    const flushViewport = useCallback(() => {
        frameRef.current = null;
        if (pendingRef.current) onViewportChange(pendingRef.current);
    }, [onViewportChange]);

    const queueViewport = useCallback((next: ViewportTransform) => {
        pendingRef.current = next;
        frameRef.current = requestFrame(flushViewport, frameRef.current);
    }, [flushViewport]);

    const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        if (isCanvasInputBlocked(event.target)) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        queueViewport(zoomViewportFromWheel(viewportRef.current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, event.deltaY));
    }, [containerRef, queueViewport]);

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (isCanvasInputBlocked(event.target) || (event.target instanceof Element && event.target.closest("[data-connection-create-menu]"))) return;
        const background = isCanvasBackgroundTarget(event.target);
        const { activeTool } = chooseCanvasTool(tool, event, spacePressed);
        const shouldPan = event.button === 1 || (event.button === 0 && activeTool === "pan" && background);
        if (shouldPan) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            panRef.current = { active: true, startedOnBackground: background, moved: false, startX: event.clientX, startY: event.clientY, initial: viewportRef.current };
            setPanning(true);
            document.body.style.cursor = "grabbing";
            return;
        }
        if (event.button === 0 && background) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
        }
    }, [onCanvasMouseDown, spacePressed, tool]);

    const onDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (isCanvasInputBlocked(event.target) || (event.target instanceof Element && event.target.closest("[data-node-id],[data-connection-id]"))) return;
        onCanvasDoubleClick?.(event);
    }, [onCanvasDoubleClick]);

    useEffect(() => {
        const onPointerMove = (event: PointerEvent) => {
            const session = panRef.current;
            if (!session.active) return;
            const dx = event.clientX - session.startX;
            const dy = event.clientY - session.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) session.moved = true;
            queueViewport(panViewportFromPointer(session.initial, dx, dy, viewportRef.current.k));
        };
        const onPointerUp = () => {
            const session = panRef.current;
            if (!session.active) return;
            if (!session.moved && session.startedOnBackground) onCanvasDeselect?.();
            panRef.current = { ...session, active: false };
            setPanning(false);
            document.body.style.cursor = "";
        };
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerUp);
        };
    }, [onCanvasDeselect, queueViewport]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const preventPageScroll = (event: WheelEvent) => {
            if (!isCanvasInputBlocked(event.target)) event.preventDefault();
        };
        container.addEventListener("wheel", preventPageScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventPageScroll);
    }, [containerRef]);

    const activeTool = spacePressed ? "pan" : controlPressed || shiftPressed ? "select" : tool;
    return {
        onWheel,
        onPointerDown,
        onDoubleClick,
        activeTool,
        isPanning: panning,
        cursor: panning ? "grabbing" : activeTool === "pan" ? "grab" : undefined,
    };
}
