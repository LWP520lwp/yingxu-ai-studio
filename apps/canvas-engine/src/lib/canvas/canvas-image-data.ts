import {
  boundedAngle,
  normalizeCropRect,
  normalizeSplitLines,
  resolveUpscaleDimensions,
} from "@/lib/canvas/canvas-image-geometry";

export type ImageCropRect = { x: number; y: number; width: number; height: number };
export type ImageAngleTransform = { horizontalAngle: number; pitchAngle: number; cameraDistance: number; wideAngle: boolean };
export type ImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";
export const MAX_UPSCALE_LONG_EDGE = 4096;
export type ImageUpscaleParams = { targetLongEdge: number; algorithm: ImageUpscaleAlgorithm };
export type ImageSplitParams = { rows: number; columns: number; horizontalLines?: number[]; verticalLines?: number[] };
export type ImageSplitPiece = { row: number; column: number; dataUrl: string };

export async function cropDataUrl(dataUrl: string, crop?: ImageCropRect) {
  const image = await loadSource(dataUrl);
  const source = crop
    ? normalizeCropRect({
        x: crop.x * image.width,
        y: crop.y * image.height,
        width: crop.width * image.width,
        height: crop.height * image.height,
      }, image)
    : centeredSquare(image.width, image.height);
  return encodeCrop(image, source.x, source.y, source.width, source.height);
}

export async function splitDataUrl(dataUrl: string, params: ImageSplitParams): Promise<ImageSplitPiece[]> {
  const image = await loadSource(dataUrl);
  const columns = boundedCount(params.columns);
  const rows = boundedCount(params.rows);
  const x = normalizeSplitLines(params.verticalLines, image.width, columns);
  const y = normalizeSplitLines(params.horizontalLines, image.height, rows);
  const pieces: ImageSplitPiece[] = [];

  for (let row = 0; row + 1 < y.length; row += 1) {
    for (let column = 0; column + 1 < x.length; column += 1) {
      const left = x[column];
      const top = y[row];
      pieces.push({
        row,
        column,
        dataUrl: encodeCrop(image, left, top, x[column + 1] - left, y[row + 1] - top),
      });
    }
  }
  return pieces;
}

export async function transformAngleDataUrl(dataUrl: string, params: ImageAngleTransform) {
  const image = await loadSource(dataUrl);
  const margin = Math.ceil(Math.max(image.width, image.height) * 0.2);
  const canvas = makeCanvas(image.width + margin * 2, image.height + margin * 2);
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  const yaw = boundedAngle(params.horizontalAngle, -60, 60) / 60;
  const pitch = boundedAngle(params.pitchAngle, -45, 45) / 45;
  const distance = boundedAngle(params.cameraDistance, 1, 10);
  const scale = clamp((1.13 - distance * 0.035) * (params.wideAngle ? 0.9 : 1), 0.62, 1.1);
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  context.save();
  context.translate(centerX + yaw * margin * 0.5, centerY + pitch * margin * 0.45);
  context.transform(1, pitch * 0.075, -yaw * 0.095, 1, 0, 0);
  context.scale(scale * (1 - Math.abs(yaw) * 0.26), scale * (1 - Math.abs(pitch) * 0.16));
  context.drawImage(image, -image.width / 2, -image.height / 2);
  context.restore();

  if (params.wideAngle) {
    const vignette = context.createRadialGradient(centerX, centerY, Math.min(canvas.width, canvas.height) * 0.22, centerX, centerY, Math.max(canvas.width, canvas.height) * 0.65);
    vignette.addColorStop(0, "rgba(255,255,255,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.16)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/png");
}

export async function upscaleDataUrl(dataUrl: string, params: ImageUpscaleParams) {
  const image = await loadSource(dataUrl);
  const output = resolveUpscaleSize(image.width, image.height, params.targetLongEdge);
  const canvas = params.algorithm === "high"
    ? progressiveUpscale(image, output.width, output.height)
    : resizeCanvas(image, image.width, image.height, output.width, output.height, params.algorithm);
  return canvas.toDataURL("image/png");
}

export function resolveUpscaleSize(width: number, height: number, targetLongEdge: number) {
  return resolveUpscaleDimensions(width, height, targetLongEdge, MAX_UPSCALE_LONG_EDGE);
}

function centeredSquare(width: number, height: number) {
  const edge = Math.min(width, height);
  return { x: Math.floor((width - edge) / 2), y: Math.floor((height - edge) / 2), width: edge, height: edge };
}

function boundedCount(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(64, Math.floor(value))) : 1;
}

function encodeCrop(image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const canvas = makeCanvas(Math.max(1, width), Math.max(1, height));
  const context = canvas.getContext("2d");
  if (!context) return image.src;
  context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function progressiveUpscale(image: HTMLImageElement, width: number, height: number) {
  let source: CanvasImageSource = image;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  while (sourceWidth < width || sourceHeight < height) {
    const nextWidth = Math.min(width, sourceWidth * 2);
    const nextHeight = Math.min(height, sourceHeight * 2);
    source = resizeCanvas(source, sourceWidth, sourceHeight, nextWidth, nextHeight, "high");
    sourceWidth = nextWidth;
    sourceHeight = nextHeight;
  }
  return resizeCanvas(source, sourceWidth, sourceHeight, width, height, "high");
}

function resizeCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  algorithm: ImageUpscaleAlgorithm,
) {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.imageSmoothingEnabled = algorithm !== "nearest";
  context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
  return canvas;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

function loadSource(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0
      ? resolve(image)
      : reject(new Error("Image has no readable pixels"));
    image.onerror = () => reject(new Error("Image data could not be decoded"));
    image.src = dataUrl;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
