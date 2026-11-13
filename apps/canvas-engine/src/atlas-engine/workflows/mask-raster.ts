import type { AtlasMaskStroke } from "@/atlas-engine/workflows/mask-strokes";

export type AtlasMaskCanvasPoint = { x: number; y: number };
export type AtlasMaskCanvasBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type AtlasMaskCanvasSize = { width: number; height: number };
export type AtlasMaskRenderStyle = { color: string };

export const ATLAS_MASK_BRUSH_MIN = 8;
export const ATLAS_MASK_BRUSH_MAX = 160;
export const ATLAS_MASK_BRUSH_STEP = 2;
export const ATLAS_MASK_OVERLAY = "#2563eb";
export const ATLAS_MASK_OVERLAY_OPACITY = 0.4;

export function mapAtlasMaskPoint(
  clientX: number,
  clientY: number,
  bounds: AtlasMaskCanvasBounds,
  canvas: AtlasMaskCanvasSize,
): AtlasMaskCanvasPoint {
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  return {
    x: ((clientX - bounds.left) / width) * canvas.width,
    y: ((clientY - bounds.top) / height) * canvas.height,
  };
}

export function clampAtlasMaskBrushSize(value: number): number {
  const snapped = Math.round(value / ATLAS_MASK_BRUSH_STEP) * ATLAS_MASK_BRUSH_STEP;
  return Math.min(ATLAS_MASK_BRUSH_MAX, Math.max(ATLAS_MASK_BRUSH_MIN, snapped));
}

export function clearAtlasMaskCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

export function renderAtlasMaskSegment(
  context: CanvasRenderingContext2D,
  stroke: AtlasMaskStroke,
  from: AtlasMaskCanvasPoint,
  to: AtlasMaskCanvasPoint,
  style: AtlasMaskRenderStyle,
): void {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  context.beginPath();
  if (from.x === to.x && from.y === to.y) {
    context.arc(to.x, to.y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  context.restore();
}

export function renderAtlasMaskStroke(
  context: CanvasRenderingContext2D | null,
  stroke: AtlasMaskStroke,
  style: AtlasMaskRenderStyle,
): void {
  if (!context) return;
  let previous: AtlasMaskCanvasPoint | null = null;
  for (const point of stroke.points) {
    renderAtlasMaskSegment(context, stroke, previous ?? point, point, style);
    previous = point;
  }
}

export function replayAtlasMaskLayers(
  strokes: readonly AtlasMaskStroke[],
  baseMaskCanvas: HTMLCanvasElement | null,
  basePreviewCanvas: HTMLCanvasElement | null,
  maskCanvas: HTMLCanvasElement | null,
  previewCanvas: HTMLCanvasElement | null,
): void {
  const maskContext = maskCanvas?.getContext("2d", { willReadFrequently: true });
  const previewContext = previewCanvas?.getContext("2d");
  if (!maskCanvas || !maskContext || !previewCanvas || !previewContext) return;
  maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  if (baseMaskCanvas) maskContext.drawImage(baseMaskCanvas, 0, 0);
  if (basePreviewCanvas) previewContext.drawImage(basePreviewCanvas, 0, 0);
  for (const stroke of strokes) {
    renderAtlasMaskStroke(maskContext, stroke, { color: "#000" });
    renderAtlasMaskStroke(previewContext, stroke, { color: ATLAS_MASK_OVERLAY });
  }
}

export function hasAtlasMaskPixels(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let alpha = 3; alpha < data.length; alpha += 4) {
    if (data[alpha] > 0) return true;
  }
  return false;
}

export function composeAtlasMaskOverlay(
  image: HTMLImageElement,
  selection: HTMLCanvasElement,
): string {
  const composed = document.createElement("canvas");
  composed.width = selection.width;
  composed.height = selection.height;
  const context = composed.getContext("2d");
  if (!context) return selection.toDataURL("image/png");
  context.drawImage(image, 0, 0, composed.width, composed.height);

  const colorized = document.createElement("canvas");
  colorized.width = composed.width;
  colorized.height = composed.height;
  const overlayContext = colorized.getContext("2d");
  if (!overlayContext) return composed.toDataURL("image/png");
  overlayContext.drawImage(selection, 0, 0);
  overlayContext.globalCompositeOperation = "source-in";
  overlayContext.fillStyle = ATLAS_MASK_OVERLAY;
  overlayContext.fillRect(0, 0, colorized.width, colorized.height);
  context.globalAlpha = ATLAS_MASK_OVERLAY_OPACITY;
  context.drawImage(colorized, 0, 0);
  return composed.toDataURL("image/png");
}
