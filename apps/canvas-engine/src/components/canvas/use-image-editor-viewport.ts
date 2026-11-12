import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  fitImageToEditorViewport,
  IMAGE_EDITOR_MAX_ZOOM,
  IMAGE_EDITOR_MIN_ZOOM,
  imageEditorPanScroll,
  imageEditorLayout,
  normalizeImageEditorSize,
  scrollForZoomAnchor,
  zoomAnchorAtPoint,
} from "@/lib/canvas/image-editor-viewport-geometry";

type ImageSize = { width: number; height: number };
type PanGesture = { pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number };
const ZOOM_FACTOR = 1.2;

export function useImageEditorViewport(image: ImageSize | null, open: boolean) {
  const viewportElement = useRef<HTMLDivElement | null>(null);
  const stageElement = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<PanGesture | null>(null);
  const anchor = useRef<{ zoom: number; ratioX: number; ratioY: number; viewportX: number; viewportY: number } | null>(null);
  const currentZoom = useRef(IMAGE_EDITOR_MIN_ZOOM);
  const spaceHeld = useRef(false);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [availableSize, setAvailableSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(IMAGE_EDITOR_MIN_ZOOM);
  const [dragging, setDragging] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);

  const viewportRef = useCallback((element: HTMLDivElement | null) => {
    viewportElement.current = element;
    setContainer(element);
  }, []);

  const endGesture = useCallback(() => {
    const element = viewportElement.current;
    const active = gesture.current;
    gesture.current = null;
    if (element && active) {
      try {
        if (element.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId);
      } catch {
        // Closing the dialog can detach the viewport between pointer events.
      }
    }
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!open) {
      endGesture();
      return;
    }
    anchor.current = null;
    currentZoom.current = IMAGE_EDITOR_MIN_ZOOM;
    setZoom(IMAGE_EDITOR_MIN_ZOOM);
    endGesture();
    if (viewportElement.current) {
      viewportElement.current.scrollLeft = 0;
      viewportElement.current.scrollTop = 0;
    }
  }, [image?.height, image?.width, open, endGesture]);

  useEffect(() => {
    if (!open) return;
    const clearSpace = () => {
      spaceHeld.current = false;
      setSpacePressed(false);
      endGesture();
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input,textarea,select,[contenteditable='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches("button,a,[role='button']")) focused.blur();
      spaceHeld.current = true;
      setSpacePressed(true);
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !spaceHeld.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      spaceHeld.current = false;
      setSpacePressed(false);
      endGesture();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", clearSpace);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", clearSpace);
      clearSpace();
    };
  }, [open, endGesture]);

  useEffect(() => {
    if (!open || !container) return;
    const measure = () => {
      const next = normalizeImageEditorSize({ width: container.clientWidth, height: container.clientHeight });
      setAvailableSize((previous) => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [container, open]);

  const sourceSize = normalizeImageEditorSize(image);
  const fittedSize = fitImageToEditorViewport(sourceSize, availableSize);
  const layout = imageEditorLayout(fittedSize, availableSize, zoom);

  useLayoutEffect(() => {
    const element = viewportElement.current;
    const pending = anchor.current;
    if (!element || !pending || Math.abs(pending.zoom - zoom) > 0.001) return;
    const scroll = scrollForZoomAnchor(pending, fittedSize, { width: element.clientWidth, height: element.clientHeight });
    element.scrollLeft = scroll.left;
    element.scrollTop = scroll.top;
    anchor.current = null;
  }, [fittedSize.height, fittedSize.width, zoom]);

  const zoomAround = useCallback((requested: number, clientX?: number, clientY?: number) => {
    const element = viewportElement.current;
    if (!element || !fittedSize.width || !fittedSize.height) return;
    const bounds = element.getBoundingClientRect();
    const nextAnchor = zoomAnchorAtPoint({
      baseSize: fittedSize,
      viewport: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
      scroll: { x: element.scrollLeft, y: element.scrollTop },
      currentZoom: currentZoom.current,
      nextZoom: requested,
      clientPoint: clientX === undefined || clientY === undefined ? undefined : { x: clientX, y: clientY },
      previousAnchor: anchor.current,
    });
    if (!nextAnchor) return;
    anchor.current = nextAnchor;
    currentZoom.current = nextAnchor.zoom;
    setZoom(nextAnchor.zoom);
  }, [fittedSize.height, fittedSize.width]);

  useEffect(() => {
    if (!open || !container) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      zoomAround(currentZoom.current * direction, event.clientX, event.clientY);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [container, open, zoomAround]);

  const beginPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 && !(event.button === 0 && spaceHeld.current)) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    };
    element.setPointerCapture(event.pointerId);
    setDragging(true);
  }, []);
  const movePan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const position = imageEditorPanScroll(
      { pointerX: active.startX, pointerY: active.startY, scrollLeft: active.scrollLeft, scrollTop: active.scrollTop },
      { x: event.clientX, y: event.clientY },
    );
    event.currentTarget.scrollLeft = position.left;
    event.currentTarget.scrollTop = position.top;
  }, []);
  const finishPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    endGesture();
  }, [endGesture]);
  const suppressMiddleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    viewportRef,
    stageRef: stageElement,
    zoom,
    isPanning: dragging,
    spacePressed,
    scrollClassName: zoom > IMAGE_EDITOR_MIN_ZOOM + 0.001 ? "overflow-scroll" : "overflow-hidden",
    panHandlers: {
      onPointerDownCapture: beginPan,
      onPointerMoveCapture: movePan,
      onPointerUpCapture: finishPan,
      onPointerCancelCapture: finishPan,
      onAuxClick: suppressMiddleClick,
    },
    canZoomIn: zoom < IMAGE_EDITOR_MAX_ZOOM,
    canZoomOut: zoom > IMAGE_EDITOR_MIN_ZOOM,
    imageScale: sourceSize.width ? layout.stageSize.width / sourceSize.width : 0,
    zoomIn: () => zoomAround(currentZoom.current * ZOOM_FACTOR),
    zoomOut: () => zoomAround(currentZoom.current / ZOOM_FACTOR),
    resetZoom: () => zoomAround(IMAGE_EDITOR_MIN_ZOOM),
    contentStyle: { width: layout.contentSize.width, height: layout.contentSize.height } satisfies CSSProperties,
    stageStyle: { left: layout.stageOffset.x, top: layout.stageOffset.y, width: layout.stageSize.width, height: layout.stageSize.height } satisfies CSSProperties,
    mediaStyle: { width: fittedSize.width, height: fittedSize.height, transform: `translateZ(0) scale(${zoom})`, transformOrigin: "top left" } satisfies CSSProperties,
  };
}
