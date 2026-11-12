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

const zoomStep = 1.2;

export function useImageEditorViewport(image: ImageSize | null, open: boolean) {
  const viewportNodeRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const zoomAnchorRef = useRef<{
    zoom: number;
    ratioX: number;
    ratioY: number;
    viewportX: number;
    viewportY: number;
  } | null>(null);
  const zoomRef = useRef(IMAGE_EDITOR_MIN_ZOOM);
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [viewportSize, setViewportSize] = useState<ImageSize>({
    width: 0,
    height: 0,
  });
  const [zoom, setZoom] = useState(IMAGE_EDITOR_MIN_ZOOM);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const spacePressedRef = useRef(false);
  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    viewportNodeRef.current = node;
    setViewportElement(node);
  }, []);

  const stopPan = useCallback((updateState = true) => {
    const viewport = viewportNodeRef.current;
    const pan = panRef.current;
    panRef.current = null;
    try {
      if (viewport && pan && viewport.hasPointerCapture(pan.pointerId)) {
        viewport.releasePointerCapture(pan.pointerId);
      }
    } catch {
      // The viewport may have detached while the dialog was closing.
    }
    if (updateState) setIsPanning(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopPan();
      return;
    }
    zoomAnchorRef.current = null;
    zoomRef.current = IMAGE_EDITOR_MIN_ZOOM;
    setZoom(IMAGE_EDITOR_MIN_ZOOM);
    stopPan();
  }, [image?.height, image?.width, open, stopPan]);

  useEffect(() => {
    if (!open) return;
    const releaseSpace = () => {
      spacePressedRef.current = false;
      setSpacePressed(false);
      stopPan();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input,textarea,[contenteditable='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (
        document.activeElement instanceof HTMLElement &&
        document.activeElement.matches("button,a,[role='button']")
      )
        document.activeElement.blur();
      spacePressedRef.current = true;
      setSpacePressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !spacePressedRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      spacePressedRef.current = false;
      stopPan(false);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", releaseSpace);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", releaseSpace);
      releaseSpace();
    };
  }, [open, stopPan]);

  useEffect(() => {
    if (!open || !viewportElement) return;
    const updateSize = () => {
      const width = viewportElement.clientWidth;
      const height = viewportElement.clientHeight;
      const next = normalizeImageEditorSize({ width, height });
      setViewportSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [open, viewportElement]);

  const normalizedImage = normalizeImageEditorSize(image);
  const baseSize = fitImageToEditorViewport(normalizedImage, viewportSize);
  const { stageSize, contentSize, stageOffset } = imageEditorLayout(
    baseSize,
    viewportSize,
    zoom,
  );

  useLayoutEffect(() => {
    const viewport = viewportNodeRef.current;
    const anchor = zoomAnchorRef.current;
    if (!viewport || !anchor || Math.abs(anchor.zoom - zoom) > 0.001) return;
    const nextScroll = scrollForZoomAnchor(anchor, baseSize, {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    });
    viewport.scrollLeft = nextScroll.left;
    viewport.scrollTop = nextScroll.top;
    zoomAnchorRef.current = null;
  }, [baseSize.height, baseSize.width, zoom]);

  const setZoomAround = useCallback(
    (nextZoom: number, clientX?: number, clientY?: number) => {
      const viewport = viewportNodeRef.current;
      if (!viewport || !baseSize.width || !baseSize.height) return;
      const currentZoom = zoomRef.current;
      const viewportRect = viewport.getBoundingClientRect();
      const anchor = zoomAnchorAtPoint({
        baseSize,
        viewport: {
          left: viewportRect.left,
          top: viewportRect.top,
          width: viewportRect.width,
          height: viewportRect.height,
        },
        scroll: { x: viewport.scrollLeft, y: viewport.scrollTop },
        currentZoom,
        nextZoom,
        clientPoint:
          clientX === undefined || clientY === undefined
            ? undefined
            : { x: clientX, y: clientY },
        previousAnchor: zoomAnchorRef.current,
      });
      if (!anchor) return;
      zoomAnchorRef.current = anchor;
      zoomRef.current = anchor.zoom;
      setZoom(anchor.zoom);
    },
    [baseSize.height, baseSize.width],
  );

  useEffect(() => {
    if (!open || !viewportElement) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setZoomAround(
        event.deltaY < 0
          ? zoomRef.current * zoomStep
          : zoomRef.current / zoomStep,
        event.clientX,
        event.clientY,
      );
    };
    viewportElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewportElement.removeEventListener("wheel", handleWheel);
  }, [open, setZoomAround, viewportElement]);

  const startPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 && !(event.button === 0 && spacePressedRef.current))
      return;
    event.preventDefault();
    event.stopPropagation();
    const viewport = event.currentTarget;
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }, []);
  const movePan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || event.pointerId !== pan.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const scroll = imageEditorPanScroll(
      {
        pointerX: pan.x,
        pointerY: pan.y,
        scrollLeft: pan.scrollLeft,
        scrollTop: pan.scrollTop,
      },
      { x: event.clientX, y: event.clientY },
    );
    event.currentTarget.scrollLeft = scroll.left;
    event.currentTarget.scrollTop = scroll.top;
  }, []);
  const stopPanFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      if (!pan || event.pointerId !== pan.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      stopPan();
    },
    [stopPan],
  );
  const preventAuxClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  return {
    viewportRef,
    stageRef,
    zoom,
    isPanning,
    spacePressed,
    scrollClassName:
      zoom > IMAGE_EDITOR_MIN_ZOOM + 0.001
        ? "overflow-scroll"
        : "overflow-hidden",
    panHandlers: {
      onPointerDownCapture: startPan,
      onPointerMoveCapture: movePan,
      onPointerUpCapture: stopPanFromPointer,
      onPointerCancelCapture: stopPanFromPointer,
      onAuxClick: preventAuxClick,
    },
    canZoomIn: zoom < IMAGE_EDITOR_MAX_ZOOM,
    canZoomOut: zoom > IMAGE_EDITOR_MIN_ZOOM,
    imageScale: normalizedImage.width
      ? stageSize.width / normalizedImage.width
      : 0,
    zoomIn: () => setZoomAround(zoomRef.current * zoomStep),
    zoomOut: () => setZoomAround(zoomRef.current / zoomStep),
    resetZoom: () => setZoomAround(IMAGE_EDITOR_MIN_ZOOM),
    contentStyle: {
      width: contentSize.width,
      height: contentSize.height,
    } satisfies CSSProperties,
    stageStyle: {
      left: stageOffset.x,
      top: stageOffset.y,
      width: stageSize.width,
      height: stageSize.height,
    } satisfies CSSProperties,
    mediaStyle: {
      width: baseSize.width,
      height: baseSize.height,
      transform: `translateZ(0) scale(${zoom})`,
      transformOrigin: "top left",
    } satisfies CSSProperties,
  };
}
