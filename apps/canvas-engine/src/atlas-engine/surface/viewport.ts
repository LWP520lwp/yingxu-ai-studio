export type AtlasCanvasViewportValue = Readonly<{
  x: number;
  y: number;
  k: number;
}>;
export type AtlasCanvasPoint = Readonly<{ x: number; y: number }>;
export type AtlasCanvasBackground = "dots" | "lines" | "blank";

export const ATLAS_ZOOM_LIMITS = { minScale: 0.05, maxScale: 5 } as const;
export type AtlasZoomLimits = { minScale: number; maxScale: number };

export function clampCanvasZoom(
  value: number,
  limits: AtlasZoomLimits = ATLAS_ZOOM_LIMITS,
) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(limits.minScale, Math.min(limits.maxScale, value));
}

function validView(view: AtlasCanvasViewportValue) {
  return (
    Number.isFinite(view.x) &&
    Number.isFinite(view.y) &&
    Number.isFinite(view.k) &&
    view.k > 0
  );
}

export function zoomCanvasAt(
  view: AtlasCanvasViewportValue,
  anchor: AtlasCanvasPoint,
  factor: number,
  limits?: AtlasZoomLimits,
): AtlasCanvasViewportValue {
  if (
    !validView(view) ||
    !Number.isFinite(anchor.x) ||
    !Number.isFinite(anchor.y) ||
    !Number.isFinite(factor) ||
    factor <= 0
  ) {
    return view;
  }
  const k = clampCanvasZoom(view.k * factor, limits);
  if (k === view.k) return view;
  const ratio = k / view.k;
  return {
    k,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}

export function panCanvasBy(
  view: AtlasCanvasViewportValue,
  delta: AtlasCanvasPoint,
): AtlasCanvasViewportValue {
  if (
    !validView(view) ||
    !Number.isFinite(delta.x) ||
    !Number.isFinite(delta.y)
  )
    return view;
  const x = view.x + delta.x;
  const y = view.y + delta.y;
  return Number.isFinite(x) && Number.isFinite(y) ? { ...view, x, y } : view;
}

export function wheelZoomFactor(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  if (!Number.isFinite(deltaY)) return 1;
  const pageHeight = Number.isFinite(viewportHeight)
    ? Math.max(1, viewportHeight)
    : 1;
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1;
  const exponent = Math.max(
    -Math.log(10),
    Math.min(Math.log(10), -deltaY * unit * 0.0015),
  );
  return Math.exp(exponent);
}

function positiveModulo(value: number, period: number) {
  return ((value % period) + period) % period;
}

export function canvasGridStyle(
  view: AtlasCanvasViewportValue,
  mode: AtlasCanvasBackground,
):
  | {
      backgroundImage: string;
      backgroundSize: string;
      backgroundPosition: string;
    }
  | undefined {
  if (mode === "blank" || !validView(view)) return undefined;
  const baseSpacing = 48 * view.k;
  const spacing =
    baseSpacing *
    Math.pow(2, Math.max(0, Math.ceil(Math.log2(32 / baseSpacing))));
  const radius = view.k < 0.12 ? 0.8 : 1.15;
  const backgroundImage =
    mode === "dots"
      ? `radial-gradient(circle, var(--atlas-grid-dot, #6f86ad) ${radius}px, transparent ${radius + 0.2}px)`
      : "linear-gradient(var(--atlas-grid-line, #263452) 1px, transparent 1px), linear-gradient(90deg, var(--atlas-grid-line, #263452) 1px, transparent 1px)";
  return {
    backgroundImage,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${positiveModulo(view.x, spacing)}px ${positiveModulo(view.y, spacing)}px`,
  };
}

export function crossedPanThreshold(
  start: AtlasCanvasPoint,
  current: AtlasCanvasPoint,
  threshold = 3,
) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
