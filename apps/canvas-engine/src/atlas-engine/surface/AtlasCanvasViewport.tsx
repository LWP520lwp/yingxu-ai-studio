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

import {
  canvasGridStyle,
  crossedPanThreshold,
  panCanvasBy,
  wheelZoomFactor,
  zoomCanvasAt,
  type AtlasCanvasBackground,
  type AtlasCanvasPoint,
  type AtlasCanvasViewportValue,
  type AtlasZoomLimits,
} from "./viewport";

type AtlasTool = "select" | "pan";
type PanSession = Readonly<{
  pointerId: number;
  origin: AtlasCanvasPoint;
  viewport: AtlasCanvasViewportValue;
  moved: boolean;
}>;

type ViewportProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  viewport: AtlasCanvasViewportValue;
  tool: AtlasTool;
  backgroundMode?: AtlasCanvasBackground;
  onViewportChange: (viewport: AtlasCanvasViewportValue) => void;
  onInteractionStart?: () => void;
  animating?: boolean;
  gesture?: string | null;
  zoomLimits?: AtlasZoomLimits;
  onCanvasMouseDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onCanvasDeselect?: () => void;
  onCanvasDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

function elementFor(target: EventTarget | null): Element | null {
  return typeof Element !== "undefined" && target instanceof Element
    ? target
    : null;
}

function isCanvasControl(target: EventTarget | null) {
  return Boolean(
    elementFor(target)?.closest(
      "[data-canvas-no-zoom],[data-atlas-stop-wheel],input,textarea,select,[contenteditable='true'],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown",
    ),
  );
}

function isCanvasBackground(target: EventTarget | null) {
  return !elementFor(target)?.closest(
    "[data-node-id],[data-connection-id],[data-connection-create-menu],[data-node-create-menu]",
  );
}

function isSpaceEditableTarget(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement))
    return false;
  return (
    target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
  );
}

export function AtlasCanvasViewport({
  containerRef,
  viewport,
  tool,
  backgroundMode = "lines",
  onViewportChange,
  onInteractionStart,
  animating = false,
  gesture,
  zoomLimits,
  onCanvasMouseDown,
  onCanvasDeselect,
  onCanvasDoubleClick,
  onContextMenu,
  onDrop,
  children,
}: ViewportProps) {
  const current = useRef(viewport);
  const queued = useRef<AtlasCanvasViewportValue | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const pan = useRef<PanSession | undefined>(undefined);
  const publish = useRef(onViewportChange);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const grid = useMemo(
    () => canvasGridStyle(viewport, backgroundMode),
    [backgroundMode, viewport],
  );

  current.current = viewport;
  publish.current = onViewportChange;

  useEffect(() => {
    const resetPan = () => {
      pan.current = undefined;
      setDragging(false);
      setSpaceHeld(false);
      document.body.style.cursor = "";
    };
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.repeat ||
        isSpaceEditableTarget(event.target)
      )
        return;
      event.preventDefault();
      setSpaceHeld(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", resetPan);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", resetPan);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      queued.current = undefined;
      document.body.style.cursor = "";
    };
  }, []);

  const schedule = (next: AtlasCanvasViewportValue) => {
    current.current = next;
    queued.current = next;
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const pending = queued.current;
      queued.current = undefined;
      if (pending) publish.current(pending);
    });
  };

  const canvasPoint = (event: {
    clientX: number;
    clientY: number;
  }): AtlasCanvasPoint => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (isCanvasControl(event.target)) return;
    event.preventDefault();
    onInteractionStart?.();
    if (gesture || pan.current) return;
    // Wheel input commits synchronously: a later pointer/navigation command cannot
    // be overwritten by a queued wheel frame from an earlier interaction.
    const next = zoomCanvasAt(
      current.current,
      canvasPoint(event),
      wheelZoomFactor(
        event.deltaY,
        event.deltaMode,
        event.currentTarget.clientHeight,
      ),
      zoomLimits,
    );
    current.current = next;
    publish.current(next);
  };
  const flushPending = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    const next = queued.current;
    queued.current = undefined;
    if (next) {
      current.current = next;
      publish.current(next);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      isCanvasControl(event.target) ||
      elementFor(event.target)?.closest("[data-connection-create-menu]")
    )
      return;
    const background = isCanvasBackground(event.target);
    const shouldPan =
      event.button === 1 ||
      (event.button === 0 &&
        background &&
        (spaceHeld || (tool === "pan" && !event.ctrlKey && !event.shiftKey)));
    if (shouldPan) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = {
        pointerId: event.pointerId,
        origin: { x: event.clientX, y: event.clientY },
        viewport: current.current,
        moved: false,
      };
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
    const delta = {
      x: event.clientX - active.origin.x,
      y: event.clientY - active.origin.y,
    };
    if (
      !active.moved &&
      !crossedPanThreshold(active.origin, {
        x: event.clientX,
        y: event.clientY,
      })
    )
      return;
    if (!active.moved) pan.current = { ...active, moved: true };
    schedule(panCanvasBy(active.viewport, delta));
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerId !== event.pointerId) return;
    flushPending();
    if (!pan.current.moved) onCanvasDeselect?.();
    pan.current = undefined;
    setDragging(false);
    document.body.style.cursor = "";
  };

  const cancelPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerId !== event.pointerId) return;
    flushPending();
    pan.current = undefined;
    setDragging(false);
    document.body.style.cursor = "";
  };

  return (
    <div
      ref={containerRef}
      data-canvas-viewport
      data-studio-gesture={gesture || (dragging ? "pan" : undefined)}
      data-camera-moving={animating || undefined}
      className="atlas-canvas-viewport relative h-full w-full select-none overflow-hidden"
      style={{
        background: "var(--atlas-canvas-bg, #0b1020)",
        cursor:
          dragging || gesture === "move" || gesture === "pan"
            ? "grabbing"
            : tool === "pan" || spaceHeld
              ? "grab"
              : undefined,
        touchAction: "none",
      }}
      onPointerDownCapture={() => {
        flushPending();
        onInteractionStart?.();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={cancelPointer}
      onDoubleClick={(event) => {
        if (!isCanvasControl(event.target) && isCanvasBackground(event.target))
          onCanvasDoubleClick?.(event);
      }}
      onWheel={handleWheel}
      onContextMenu={onContextMenu}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      tabIndex={0}
    >
      {grid ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={grid}
        />
      ) : null}
      <div
        data-atlas-world
        className="absolute inset-0 origin-top-left"
        style={{
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`,
          willChange:
            dragging || animating || gesture === "pan"
              ? "transform"
              : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
