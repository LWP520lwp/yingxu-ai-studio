import type { Position, ViewportTransform } from "@/types/canvas";

export type AtlasViewportSize = Readonly<{ width: number; height: number }>;
export type AtlasViewportOrigin = Readonly<{ left: number; top: number }>;

export function clientPointToCanvas(
  client: Position,
  origin: AtlasViewportOrigin,
  viewport: ViewportTransform,
): Position {
  return {
    x: (client.x - origin.left - viewport.x) / viewport.k,
    y: (client.y - origin.top - viewport.y) / viewport.k,
  };
}

export function canvasCenterInWorld(
  origin: AtlasViewportOrigin,
  size: AtlasViewportSize,
  viewport: ViewportTransform,
): Position {
  return clientPointToCanvas(
    { x: origin.left + size.width / 2, y: origin.top + size.height / 2 },
    origin,
    viewport,
  );
}

export function centeredCanvasViewport(
  size: AtlasViewportSize,
): ViewportTransform {
  return { x: size.width / 2, y: size.height / 2, k: 1 };
}

export function zoomCanvasToScale(
  viewport: ViewportTransform,
  size: AtlasViewportSize,
  scale: number,
): ViewportTransform {
  const nextScale = Math.min(Math.max(scale, 0.05), 5);
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  return {
    x: centerX - ((centerX - viewport.x) / viewport.k) * nextScale,
    y: centerY - ((centerY - viewport.y) / viewport.k) * nextScale,
    k: nextScale,
  };
}
