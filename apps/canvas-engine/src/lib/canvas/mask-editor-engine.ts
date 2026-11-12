import type { MaskStroke } from "@/lib/canvas/mask-stroke-history";

export type MaskCanvasPoint = { x: number; y: number };
export type MaskCanvasBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type MaskCanvasSize = { width: number; height: number };
export type MaskRenderStyle = { color: string };

export const MASK_BRUSH_MIN_SIZE = 8;
export const MASK_BRUSH_MAX_SIZE = 160;
export const MASK_BRUSH_SIZE_STEP = 2;
export const MASK_OVERLAY_COLOR = "#2563eb";
export const MASK_OVERLAY_ALPHA = 0.4;

export function mapMaskCanvasPoint(
  clientX: number,
  clientY: number,
  bounds: MaskCanvasBounds,
  canvas: MaskCanvasSize,
): MaskCanvasPoint {
  return {
    x: ((clientX - bounds.left) / Math.max(1, bounds.width)) * canvas.width,
    y: ((clientY - bounds.top) / Math.max(1, bounds.height)) * canvas.height,
  };
}

export function clampMaskBrushSize(value: number) {
  const rounded =
    Math.round(value / MASK_BRUSH_SIZE_STEP) * MASK_BRUSH_SIZE_STEP;
  return Math.min(MASK_BRUSH_MAX_SIZE, Math.max(MASK_BRUSH_MIN_SIZE, rounded));
}

export function clearMaskCanvas(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext("2d", { willReadFrequently: true });
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
}

export function renderMaskSegment(
  context: CanvasRenderingContext2D,
  stroke: MaskStroke,
  from: MaskCanvasPoint,
  to: MaskCanvasPoint,
  style: MaskRenderStyle,
) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  context.globalCompositeOperation =
    stroke.mode === "paint" ? "source-over" : "destination-out";
  context.strokeStyle = style.color;
  context.fillStyle = style.color;

  if (from.x === to.x && from.y === to.y) {
    context.beginPath();
    context.arc(to.x, to.y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  context.restore();
}

export function renderMaskStroke(
  context: CanvasRenderingContext2D | null,
  stroke: MaskStroke,
  style: MaskRenderStyle,
) {
  if (!context) return;
  for (let index = 0; index < stroke.points.length; index += 1) {
    const point = stroke.points[index];
    renderMaskSegment(
      context,
      stroke,
      stroke.points[index - 1] || point,
      point,
      style,
    );
  }
}

export function replayMaskLayers(
  strokes: readonly MaskStroke[],
  baseMaskCanvas: HTMLCanvasElement | null,
  basePreviewCanvas: HTMLCanvasElement | null,
  maskCanvas: HTMLCanvasElement | null,
  previewCanvas: HTMLCanvasElement | null,
) {
  const maskContext = maskCanvas?.getContext("2d", {
    willReadFrequently: true,
  });
  const previewContext = previewCanvas?.getContext("2d");
  if (!maskCanvas || !maskContext || !previewCanvas || !previewContext) return;

  maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  if (baseMaskCanvas) maskContext.drawImage(baseMaskCanvas, 0, 0);
  if (basePreviewCanvas) previewContext.drawImage(basePreviewCanvas, 0, 0);

  for (const stroke of strokes) {
    renderMaskStroke(maskContext, stroke, { color: "#000" });
    renderMaskStroke(previewContext, stroke, { color: MASK_OVERLAY_COLOR });
  }
}

export function hasMaskPixels(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) return true;
  }
  return false;
}

export function composeMaskOverlay(
  image: HTMLImageElement,
  selection: HTMLCanvasElement,
) {
  const canvas = document.createElement("canvas");
  canvas.width = selection.width;
  canvas.height = selection.height;
  const context = canvas.getContext("2d");
  if (!context) return selection.toDataURL("image/png");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const overlay = document.createElement("canvas");
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  const overlayContext = overlay.getContext("2d");
  if (!overlayContext) return canvas.toDataURL("image/png");
  overlayContext.drawImage(selection, 0, 0);
  overlayContext.globalCompositeOperation = "source-in";
  overlayContext.fillStyle = MASK_OVERLAY_COLOR;
  overlayContext.fillRect(0, 0, overlay.width, overlay.height);
  context.globalAlpha = MASK_OVERLAY_ALPHA;
  context.drawImage(overlay, 0, 0);
  return canvas.toDataURL("image/png");
}
