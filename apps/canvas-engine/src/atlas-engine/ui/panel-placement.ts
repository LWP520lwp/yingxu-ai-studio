type ScreenRect = { left: number; top: number; right: number; bottom: number };

type FitCanvasPanelInput = {
  node: ScreenRect;
  viewport: ScreenRect;
  panelWidth: number;
  panelHeight: number;
  bottomInset?: number;
  padding?: number;
  gap?: number;
};

type PanelPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

type Bounds = { left: number; top: number; right: number; bottom: number };

const MIN_PANEL_EDGE = 1;
const DEFAULT_PADDING = 12;
const DEFAULT_GAP = 16;

/** Place a counter-scaled panel in screen pixels, reserving the canvas dock. */
export function fitCanvasPanel({
  node,
  viewport,
  panelWidth,
  panelHeight,
  bottomInset = 0,
  padding = DEFAULT_PADDING,
  gap = DEFAULT_GAP,
}: FitCanvasPanelInput): PanelPlacement {
  const screen = normalizeRect(viewport);
  const anchor = normalizeRect(node, screen);
  const inset = nonNegative(bottomInset);
  const gutter = nonNegative(padding);
  const separation = nonNegative(gap);
  const bounds = visibleBounds(screen, gutter, inset);
  const width = fitLength(panelWidth, bounds.right - bounds.left);
  const maxHeight = Math.max(MIN_PANEL_EDGE, bounds.bottom - bounds.top);
  const height = Math.min(fitLength(panelHeight, maxHeight), maxHeight);

  return {
    left: fitPanelCenter(anchor.left, anchor.right, width, bounds),
    top: fitPanelVertically(anchor, height, separation, bounds),
    width,
    maxHeight,
  };
}

function normalizeRect(rect: ScreenRect, fallback?: Bounds): Bounds {
  const fallbackX = fallback ? (fallback.left + fallback.right) / 2 : 0;
  const fallbackY = fallback ? (fallback.top + fallback.bottom) / 2 : 0;
  const x1 = finite(rect.left, fallbackX);
  const x2 = finite(rect.right, fallbackX);
  const y1 = finite(rect.top, fallbackY);
  const y2 = finite(rect.bottom, fallbackY);

  return {
    left: Math.min(x1, x2),
    right: Math.max(x1, x2),
    top: Math.min(y1, y2),
    bottom: Math.max(y1, y2),
  };
}

function visibleBounds(viewport: Bounds, padding: number, bottomInset: number): Bounds {
  const left = viewport.left + padding;
  const top = viewport.top + padding;
  const right = Math.max(left + MIN_PANEL_EDGE, viewport.right - padding);
  const bottom = Math.max(top + MIN_PANEL_EDGE, viewport.bottom - bottomInset - padding);
  return { left, top, right, bottom };
}

function fitPanelCenter(nodeLeft: number, nodeRight: number, panelWidth: number, bounds: Bounds): number {
  const latestLeft = Math.max(bounds.left, bounds.right - panelWidth);
  const centered = (nodeLeft + nodeRight - panelWidth) / 2;
  return clamp(centered, bounds.left, latestLeft);
}

function fitPanelVertically(node: Bounds, panelHeight: number, gap: number, bounds: Bounds): number {
  const lowerLimit = bounds.top;
  const upperLimit = Math.max(lowerLimit, bounds.bottom - panelHeight);
  const below = node.bottom + gap;
  const above = node.top - gap - panelHeight;
  if (below + panelHeight <= bounds.bottom) return clamp(below, lowerLimit, upperLimit);
  if (above >= bounds.top) return clamp(above, lowerLimit, upperLimit);
  return clamp(below, lowerLimit, upperLimit);
}

function fitLength(value: number, available: number): number {
  const safeAvailable = Math.max(MIN_PANEL_EDGE, finite(available, MIN_PANEL_EDGE));
  const requested = Number.isFinite(value)
    ? Math.max(MIN_PANEL_EDGE, value)
    : value === Number.POSITIVE_INFINITY
      ? safeAvailable
      : MIN_PANEL_EDGE;
  return Math.min(requested, safeAvailable);
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
