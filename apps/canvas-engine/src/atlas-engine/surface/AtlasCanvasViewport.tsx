import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
} from "react";

type AtlasViewportValue = { x: number; y: number; k: number };
type AtlasTool = "select" | "pan";
type AtlasBackground = "dots" | "lines" | "blank";
type ScreenPoint = { x: number; y: number };

type ViewportProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  viewport: AtlasViewportValue;
  tool: AtlasTool;
  backgroundMode?: AtlasBackground;
  onViewportChange: (viewport: AtlasViewportValue) => void;
  onCanvasMouseDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onCanvasDeselect?: () => void;
  onCanvasDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

type PanSession = {
  pointerId: number;
  origin: ScreenPoint;
  viewport: AtlasViewportValue;
  moved: boolean;
};

const ZOOM_LIMITS = { min: 0.05, max: 5 } as const;

function finite(value: number) {
  return Number.isFinite(value);
}

function isOverlayTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(
    target.closest(
      "[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown",
    ),
  );
}

function isCanvasBackground(target: EventTarget | null) {
  return !(target instanceof Element && target.closest(
    "[data-node-id],[data-connection-id],[data-connection-create-menu],[data-node-create-menu]",
  ));
}

function zoomAround(
  viewport: AtlasViewportValue,
  anchor: ScreenPoint,
  factor: number,
): AtlasViewportValue {
  if (![viewport.x, viewport.y, viewport.k, anchor.x, anchor.y, factor].every(finite) || factor <= 0)
    return viewport;
  const nextScale = Math.max(
    ZOOM_LIMITS.min,
    Math.min(ZOOM_LIMITS.max, viewport.k * factor),
  );
  const ratio = nextScale / viewport.k;
  return {
    k: nextScale,
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
  };
}

function translate(viewport: AtlasViewportValue, delta: ScreenPoint): AtlasViewportValue {
  return finite(delta.x) && finite(delta.y)
    ? { ...viewport, x: viewport.x + delta.x, y: viewport.y + delta.y }
    : viewport;
}

export function AtlasCanvasViewport({
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
}: ViewportProps) {
  const current = useRef(viewport);
  const pending = useRef<AtlasViewportValue | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const pan = useRef<PanSession | undefined>(undefined);
  const publish = useRef(onViewportChange);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    current.current = viewport;
  }, [viewport]);

  useEffect(() => {
    publish.current = onViewportChange;
  }, [onViewportChange]);

  const schedule = (next: AtlasViewportValue) => {
    current.current = next;
    pending.current = next;
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const value = pending.current;
      pending.current = undefined;
      if (value) publish.current(value);
    });
  };

  useEffect(() => () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      setSpaceHeld(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    const reset = () => {
      pan.current = undefined;
      setDragging(false);
      document.body.style.cursor = "";
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", reset);
    };
  }, []);

  const grid = useMemo(() => {
    if (backgroundMode === "blank") return undefined;
    const step = 48 * viewport.k * (viewport.k < 0.25 ? 4 : 1);
    const radius = viewport.k < 0.12 ? 0.8 : 1.15;
    return {
      size: step,
      position: `${viewport.x % step}px ${viewport.y % step}px`,
      image: backgroundMode === "dots"
        ? `radial-gradient(circle, var(--atlas-grid-dot, #6f86ad) ${radius}px, transparent ${radius + 0.2}px)`
        : "linear-gradient(var(--atlas-grid-line, #263452) 1px, transparent 1px), linear-gradient(90deg, var(--atlas-grid-line, #263452) 1px, transparent 1px)",
    };
  }, [backgroundMode, viewport.k, viewport.x, viewport.y]);

  const pointInCanvas = (event: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (isOverlayTarget(event.target)) return;
    event.preventDefault();
    schedule(zoomAround(current.current, pointInCanvas(event), Math.exp(-event.deltaY * 0.0015)));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isOverlayTarget(event.target)) return;
    const background = isCanvasBackground(event.target);
    const shouldPan = event.button === 1 || (event.button === 0 && background && (spaceHeld || (tool === "pan" && !event.ctrlKey && !event.shiftKey)));
    if (shouldPan) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY }, viewport: current.current, moved: false };
      setDragging(true);
      document.body.style.cursor = "grabbing";
      return;
    }
    if (event.button === 0 && background) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onCanvasMouseDown?.(event);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = pan.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - active.origin.x, y: event.clientY - active.origin.y };
    if (Math.abs(delta.x) + Math.abs(delta.y) > 3) active.moved = true;
    schedule(translate(active.viewport, delta));
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    const active = pan.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.moved) onCanvasDeselect?.();
    pan.current = undefined;
    setDragging(false);
    document.body.style.cursor = "";
  };

  return (
    <div
      ref={containerRef}
      data-canvas-viewport
      className="atlas-canvas-viewport relative h-full w-full select-none overflow-hidden"
      style={{ background: "var(--atlas-canvas-bg, #0b1020)", cursor: dragging ? "grabbing" : (tool === "pan" || spaceHeld ? "grab" : undefined), touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onDoubleClick={(event) => {
        if (!isOverlayTarget(event.target) && isCanvasBackground(event.target)) onCanvasDoubleClick?.(event);
      }}
      onWheel={handleWheel}
      onContextMenu={onContextMenu}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {grid ? <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: grid.image, backgroundSize: `${grid.size}px ${grid.size}px`, backgroundPosition: grid.position }} /> : null}
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`, willChange: dragging ? "transform" : undefined }}>
        {children}
      </div>
    </div>
  );
}
