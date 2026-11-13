import { fitCanvasPanel } from "./panel-placement";

export type CanvasPanelScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CanvasPanelOverlayPlacement = ReturnType<typeof fitCanvasPanel> & {
  localLeft: number;
  localTop: number;
};

type MeasureCanvasPanelOverlayInput = {
  node: CanvasPanelScreenRect;
  viewport: CanvasPanelScreenRect;
  panelWidth: number;
  panelHeight: number;
  scale: number;
  bottomInset?: number;
};

export function measureCanvasPanelOverlay({
  node,
  viewport,
  panelWidth,
  panelHeight,
  scale,
  bottomInset = 88,
}: MeasureCanvasPanelOverlayInput): CanvasPanelOverlayPlacement {
  const canvasScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const padding = 12;
  const bottomBound = viewport.bottom - Math.max(0, bottomInset) - padding;
  const fitted = fitCanvasPanel({ node, viewport, panelWidth, panelHeight, bottomInset, padding });

  return {
    ...fitted,
    maxHeight: Math.max(1, Math.min(fitted.maxHeight, bottomBound - fitted.top)),
    localLeft: (fitted.left - node.left) / canvasScale,
    localTop: (fitted.top - node.top) / canvasScale,
  };
}

export function sameCanvasPanelPlacement(
  previous: CanvasPanelOverlayPlacement | null,
  next: CanvasPanelOverlayPlacement,
): boolean {
  return Boolean(
    previous &&
    previous.left === next.left &&
    previous.top === next.top &&
    previous.width === next.width &&
    previous.maxHeight === next.maxHeight &&
    previous.localLeft === next.localLeft &&
    previous.localTop === next.localTop,
  );
}

export function canvasPanelOverlayStyle(
  placement: CanvasPanelOverlayPlacement | null,
  scale: number,
  width: number,
) {
  const canvasScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    left: placement?.localLeft ?? "50%",
    top: placement?.localTop ?? "100%",
    width: placement?.width ?? width,
    maxHeight: placement?.maxHeight,
    transform: placement ? `scale(${1 / canvasScale})` : `translateX(-50%) scale(${1 / canvasScale})`,
    transformOrigin: placement ? "top left" : "top center",
  };
}
