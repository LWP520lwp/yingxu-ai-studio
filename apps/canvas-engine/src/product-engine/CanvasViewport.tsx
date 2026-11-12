import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject, type WheelEvent } from "react";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { panBy, zoomAt } from "./geometry";
import type { ProductViewport, Point } from "./document";

type CanvasViewportProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  viewport: { x: number; y: number; k: number };
  tool: "select" | "pan";
  backgroundMode?: CanvasBackgroundMode;
  onViewportChange: (viewport: { x: number; y: number; k: number }) => void;
  onCanvasMouseDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onCanvasDeselect?: () => void;
  onCanvasDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

type PanGesture = { pointerId: number; point: Point; origin: ProductViewport; moved: boolean };

function isBlocked(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown"));
}

function isBackground(target: EventTarget | null) {
  return !(target instanceof Element && target.closest("[data-node-id],[data-connection-id],[data-connection-create-menu],[data-node-create-menu]"));
}

export function CanvasViewport({
  containerRef,
  viewport,
  tool,
  backgroundMode = "lines",
  onViewportChange,
  onCanvasMouseDown,
  onCanvasDeselect,
  onCanvasDoubleClick,
  onContextMenu,
  onDrop,
  children,
}: CanvasViewportProps) {
  const themeName = useThemeStore((state) => state.theme);
  const theme = canvasThemes[themeName];
  const current = useRef<ProductViewport>({ x: viewport.x, y: viewport.y, scale: viewport.k });
  const pending = useRef<ProductViewport | null>(null);
  const frame = useRef<number | null>(null);
  const publish = useRef(onViewportChange);
  const gesture = useRef<PanGesture | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => { current.current = { x: viewport.x, y: viewport.y, scale: viewport.k }; }, [viewport.x, viewport.y, viewport.k]);
  useEffect(() => { publish.current = onViewportChange; }, [onViewportChange]);

  const scheduleViewport = (next: ProductViewport) => {
    current.current = next;
    pending.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const latest = pending.current;
      pending.current = null;
      if (latest) publish.current({ ...latest, k: latest.scale });
    });
  };

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      setSpaceHeld(true);
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === "Space") setSpaceHeld(false); };
    const release = () => { gesture.current = null; setPanning(false); document.body.style.cursor = ""; };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", release);
    };
  }, []);

  const pattern = useMemo(() => {
    if (backgroundMode === "blank") return undefined;
    const step = 48 * viewport.k * (viewport.k < 0.25 ? 4 : 1);
    const radius = viewport.k < 0.12 ? 0.8 : 1.15;
    return {
      size: step,
      image: backgroundMode === "dots"
        ? `radial-gradient(circle, ${theme.canvas.dot} ${radius}px, transparent ${radius + 0.2}px)`
        : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`,
      position: `${viewport.x % step}px ${viewport.y % step}px`,
    };
  }, [backgroundMode, theme.canvas.dot, theme.canvas.line, viewport.k, viewport.x, viewport.y]);

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (isBlocked(event.target)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const factor = Math.exp(-event.deltaY * 0.0015);
    scheduleViewport(zoomAt(current.current, anchor, factor));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isBlocked(event.target) || (event.target instanceof Element && event.target.closest("[data-connection-create-menu]"))) return;
    const background = isBackground(event.target);
    const shouldPan = event.button === 1 || (event.button === 0 && background && (spaceHeld || (tool === "pan" && !event.ctrlKey && !event.shiftKey)));
    if (shouldPan) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { pointerId: event.pointerId, point: { x: event.clientX, y: event.clientY }, origin: current.current, moved: false };
      setPanning(true);
      document.body.style.cursor = "grabbing";
      return;
    }
    if (event.button === 0 && background) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onCanvasMouseDown?.(event);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.point.x;
    const dy = event.clientY - active.point.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
    scheduleViewport(panBy(active.origin, { x: dx, y: dy }));
  };

  const finishPan = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.moved) onCanvasDeselect?.();
    gesture.current = null;
    setPanning(false);
    document.body.style.cursor = "";
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!isBlocked(event.target) && isBackground(event.target)) onCanvasDoubleClick?.(event);
  };

  return (
    <div
      ref={containerRef}
      data-canvas-viewport
      className="canvas-atlas-viewport relative h-full w-full select-none overflow-hidden"
      style={{ background: theme.canvas.background, cursor: panning ? "grabbing" : (tool === "pan" || spaceHeld ? "grab" : undefined), touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {pattern ? <div className="canvas-atlas-grid pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: pattern.image, backgroundSize: `${pattern.size}px ${pattern.size}px`, backgroundPosition: pattern.position }} /> : null}
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`, willChange: panning ? "transform" : undefined }}>
        {children}
      </div>
    </div>
  );
}
