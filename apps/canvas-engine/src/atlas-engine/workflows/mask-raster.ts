import type { MaskInkSurface } from "./mask-editor-session";
import type { AtlasMaskPoint, AtlasMaskStroke } from "./mask-strokes";

export type AtlasMaskCanvasPoint = AtlasMaskPoint;
export type AtlasMaskCanvasBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type AtlasMaskCanvasSize = { width: number; height: number };

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
): AtlasMaskPoint {
  return {
    x: ((clientX - bounds.left) * canvas.width) / Math.max(1, bounds.width),
    y: ((clientY - bounds.top) * canvas.height) / Math.max(1, bounds.height),
  };
}

export function clampAtlasMaskBrushSize(value: number): number {
  if (!Number.isFinite(value)) return ATLAS_MASK_BRUSH_MIN;
  const steps = Math.round(
    (value - ATLAS_MASK_BRUSH_MIN) / ATLAS_MASK_BRUSH_STEP,
  );
  return Math.max(
    ATLAS_MASK_BRUSH_MIN,
    Math.min(
      ATLAS_MASK_BRUSH_MAX,
      ATLAS_MASK_BRUSH_MIN + steps * ATLAS_MASK_BRUSH_STEP,
    ),
  );
}

/** Draw one browser sample batch as one path, including a round dot for taps. */
function inkPath(
  context: CanvasRenderingContext2D,
  stroke: AtlasMaskStroke,
  points: readonly AtlasMaskPoint[],
  color: string,
) {
  const first = points[0];
  if (!first || !Number.isFinite(stroke.size) || stroke.size <= 0) return;
  context.save();
  context.globalCompositeOperation =
    stroke.mode === "paint" ? "source-over" : "destination-out";
  context.fillStyle = context.strokeStyle = color;
  context.lineWidth = stroke.size;
  context.lineCap = context.lineJoin = "round";
  context.beginPath();
  if (points.length === 1) {
    context.arc(first.x, first.y, stroke.size / 2, 0, 2 * Math.PI);
    context.fill();
  } else {
    context.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index++)
      context.lineTo(points[index].x, points[index].y);
    context.stroke();
  }
  context.restore();
}

function blank(size: AtlasMaskCanvasSize) {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

function wipe(canvas: HTMLCanvasElement) {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

export class MaskRasterSurface implements MaskInkSurface {
  private readonly mask: HTMLCanvasElement;
  private readonly base: HTMLCanvasElement;

  constructor(private readonly preview: HTMLCanvasElement) {
    this.mask = blank(preview);
    this.base = blank(preview);
  }

  trace(stroke: AtlasMaskStroke, samples: readonly AtlasMaskPoint[]) {
    const mask = this.mask.getContext("2d", { willReadFrequently: true });
    const preview = this.preview.getContext("2d");
    if (mask) inkPath(mask, stroke, samples, "black");
    if (preview) inkPath(preview, stroke, samples, ATLAS_MASK_OVERLAY);
  }

  checkpoint(strokes: readonly AtlasMaskStroke[]) {
    const context = this.base.getContext("2d");
    if (context)
      for (const stroke of strokes)
        inkPath(context, stroke, stroke.points, "black");
  }

  restore(strokes: readonly AtlasMaskStroke[]) {
    const context = this.mask.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    wipe(this.mask);
    context.drawImage(this.base, 0, 0);
    for (const stroke of strokes)
      inkPath(context, stroke, stroke.points, "black");
    const preview = this.preview.getContext("2d");
    if (!preview) return;
    wipe(this.preview);
    preview.save();
    preview.drawImage(this.mask, 0, 0);
    preview.globalCompositeOperation = "source-in";
    preview.fillStyle = ATLAS_MASK_OVERLAY;
    preview.fillRect(0, 0, this.preview.width, this.preview.height);
    preview.restore();
  }

  clear() {
    [this.mask, this.base, this.preview].forEach(wipe);
  }

  hasPaint() {
    const context = this.mask.getContext("2d", { willReadFrequently: true });
    if (!context || !this.mask.width || !this.mask.height) return false;
    // Read bounded strips instead of allocating another full-resolution image buffer.
    for (let row = 0; row < this.mask.height; row += 64) {
      const strip = context.getImageData(
        0,
        row,
        this.mask.width,
        Math.min(64, this.mask.height - row),
      ).data;
      for (let pixel = 3; pixel < strip.length; pixel += 4)
        if (strip[pixel]) return true;
    }
    return false;
  }

  exportOverlay(image: HTMLImageElement) {
    const result = blank(this.mask);
    const context = result.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.drawImage(image, 0, 0, result.width, result.height);
    context.globalAlpha = ATLAS_MASK_OVERLAY_OPACITY;
    context.drawImage(this.preview, 0, 0);
    return result.toDataURL("image/png");
  }
}
