import {
  atlasBoundedAngle,
  atlasUpscaleDimensions,
  normalizeAtlasCropPixels,
  normalizeAtlasSplitMarks,
  type AtlasImageSize,
  type AtlasPixelRect,
} from "@/atlas-engine/surface/image-editing-geometry";

export type AtlasImageCrop = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
export type AtlasImageAngle = Readonly<{
  horizontalAngle: number;
  pitchAngle: number;
  cameraDistance: number;
  wideAngle: boolean;
}>;
export type AtlasUpscaleAlgorithm = "nearest" | "bilinear" | "high";
export type AtlasUpscaleOptions = Readonly<{
  targetLongEdge: number;
  algorithm: AtlasUpscaleAlgorithm;
}>;
export type AtlasImageSplit = Readonly<{
  rows: number;
  columns: number;
  horizontalLines?: number[];
  verticalLines?: number[];
}>;
export type AtlasImageSplitPiece = Readonly<{
  row: number;
  column: number;
  dataUrl: string;
}>;
export type AtlasUpscaleState = Readonly<{
  sourceLongEdge: number;
  outputSize: AtlasImageSize | null;
  canUpscale: boolean;
  limitMessage: "maxReached" | "targetReached" | null;
}>;

export const ATLAS_MAX_UPSCALE_EDGE = 4096;
export const ATLAS_UPSCALE_TARGETS = [
  { label: "1K", value: 1024 },
  { label: "2K", value: 2048 },
  { label: "4K", value: ATLAS_MAX_UPSCALE_EDGE },
] as const;
export const ATLAS_UPSCALE_ALGORITHMS: readonly AtlasUpscaleAlgorithm[] = [
  "high",
  "bilinear",
  "nearest",
];
export const ATLAS_DEFAULT_UPSCALE_OPTIONS: AtlasUpscaleOptions = {
  targetLongEdge: 2048,
  algorithm: "high",
};

type Raster = HTMLImageElement;

async function decodeRaster(dataUrl: string): Promise<Raster> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error("Image has no readable pixels"));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error("Image data could not be decoded"));
    image.src = dataUrl;
  });
}

function canvasFor(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

function exportRaster(image: Raster, rect: AtlasPixelRect): string {
  const canvas = canvasFor(rect.width, rect.height);
  const context = canvas.getContext("2d");
  if (!context) return image.src;
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/png");
}

function makeCropRect(image: Raster, crop?: AtlasImageCrop): AtlasPixelRect {
  const source = { width: image.naturalWidth, height: image.naturalHeight };
  if (crop) {
    return normalizeAtlasCropPixels(
      {
        x: crop.x * source.width,
        y: crop.y * source.height,
        width: crop.width * source.width,
        height: crop.height * source.height,
      },
      source,
    );
  }
  const edge = Math.min(source.width, source.height);
  return normalizeAtlasCropPixels(
    {
      x: Math.floor((source.width - edge) / 2),
      y: Math.floor((source.height - edge) / 2),
      width: edge,
      height: edge,
    },
    source,
  );
}

export async function cropAtlasImageDataUrl(
  dataUrl: string,
  crop?: AtlasImageCrop,
): Promise<string> {
  const image = await decodeRaster(dataUrl);
  return exportRaster(image, makeCropRect(image, crop));
}

export async function splitAtlasImageDataUrl(
  dataUrl: string,
  split: AtlasImageSplit,
): Promise<AtlasImageSplitPiece[]> {
  const image = await decodeRaster(dataUrl);
  const sourceSize = { width: image.naturalWidth, height: image.naturalHeight };
  const xMarks = normalizeAtlasSplitMarks(
    split.verticalLines,
    sourceSize.width,
    split.columns,
  );
  const yMarks = normalizeAtlasSplitMarks(
    split.horizontalLines,
    sourceSize.height,
    split.rows,
  );
  const pieces: AtlasImageSplitPiece[] = [];

  for (let row = 0; row < yMarks.length - 1; row += 1) {
    for (let column = 0; column < xMarks.length - 1; column += 1) {
      const rect = normalizeAtlasCropPixels(
        {
          x: xMarks[column],
          y: yMarks[row],
          width: xMarks[column + 1] - xMarks[column],
          height: yMarks[row + 1] - yMarks[row],
        },
        sourceSize,
      );
      pieces.push({ row, column, dataUrl: exportRaster(image, rect) });
    }
  }
  return pieces;
}

export async function transformAtlasImageAngle(
  dataUrl: string,
  angle: AtlasImageAngle,
): Promise<string> {
  const image = await decodeRaster(dataUrl);
  const margin = Math.ceil(
    Math.max(image.naturalWidth, image.naturalHeight) * 0.2,
  );
  const canvas = canvasFor(
    image.naturalWidth + 2 * margin,
    image.naturalHeight + 2 * margin,
  );
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  const yaw = atlasBoundedAngle(angle.horizontalAngle, -60, 60) / 60;
  const pitch = atlasBoundedAngle(angle.pitchAngle, -45, 45) / 45;
  const distance = atlasBoundedAngle(angle.cameraDistance, 1, 10);
  const lensScale = (1.13 - distance * 0.035) * (angle.wideAngle ? 0.9 : 1);
  const scale = Math.min(1.1, Math.max(0.62, lensScale));
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  context.save();
  context.translate(
    centerX + yaw * margin * 0.5,
    centerY + pitch * margin * 0.45,
  );
  context.transform(1, pitch * 0.075, -yaw * 0.095, 1, 0, 0);
  context.scale(
    scale * (1 - Math.abs(yaw) * 0.26),
    scale * (1 - Math.abs(pitch) * 0.16),
  );
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  context.restore();

  if (angle.wideAngle) {
    const vignette = context.createRadialGradient(
      centerX,
      centerY,
      Math.min(canvas.width, canvas.height) * 0.22,
      centerX,
      centerY,
      Math.max(canvas.width, canvas.height) * 0.65,
    );
    vignette.addColorStop(0, "rgba(255,255,255,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.16)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/png");
}

function drawScaled(
  source: CanvasImageSource,
  sourceSize: AtlasImageSize,
  outputSize: AtlasImageSize,
  algorithm: AtlasUpscaleAlgorithm,
): HTMLCanvasElement {
  const canvas = canvasFor(outputSize.width, outputSize.height);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.imageSmoothingEnabled = algorithm !== "nearest";
  context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
  context.drawImage(
    source,
    0,
    0,
    sourceSize.width,
    sourceSize.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

function renderHighQuality(
  image: Raster,
  destination: AtlasImageSize,
): HTMLCanvasElement {
  let source: CanvasImageSource = image;
  let size = { width: image.naturalWidth, height: image.naturalHeight };
  while (size.width < destination.width || size.height < destination.height) {
    const next = {
      width: Math.min(destination.width, size.width * 2),
      height: Math.min(destination.height, size.height * 2),
    };
    source = drawScaled(source, size, next, "high");
    size = next;
  }
  return drawScaled(source, size, destination, "high");
}

export async function upscaleAtlasImageDataUrl(
  dataUrl: string,
  options: AtlasUpscaleOptions,
): Promise<string> {
  const image = await decodeRaster(dataUrl);
  const dimensions = resolveAtlasUpscaleSize(
    image.naturalWidth,
    image.naturalHeight,
    options.targetLongEdge,
  );
  const output =
    options.algorithm === "high"
      ? renderHighQuality(image, dimensions)
      : drawScaled(
          image,
          { width: image.naturalWidth, height: image.naturalHeight },
          dimensions,
          options.algorithm,
        );
  return output.toDataURL("image/png");
}

export function resolveAtlasUpscaleSize(
  width: number,
  height: number,
  desiredLongEdge: number,
): AtlasImageSize {
  return atlasUpscaleDimensions(
    width,
    height,
    desiredLongEdge,
    ATLAS_MAX_UPSCALE_EDGE,
  );
}

export function initialAtlasUpscaleTarget(sourceLongEdge: number): number {
  return (
    ATLAS_UPSCALE_TARGETS.find(({ value }) => sourceLongEdge < value)?.value ??
    ATLAS_MAX_UPSCALE_EDGE
  );
}

export function isAtlasUpscaleAlgorithm(
  value: string,
): value is AtlasUpscaleAlgorithm {
  return ATLAS_UPSCALE_ALGORITHMS.includes(value as AtlasUpscaleAlgorithm);
}

export function isAtlasUpscaleTargetReached(
  sourceLongEdge: number,
  targetLongEdge: number,
): boolean {
  return sourceLongEdge >= targetLongEdge;
}

export function deriveAtlasUpscaleState(
  source: AtlasImageSize | null,
  targetLongEdge: number,
): AtlasUpscaleState {
  if (!source) {
    return {
      sourceLongEdge: 0,
      outputSize: null,
      canUpscale: false,
      limitMessage: null,
    };
  }

  const sourceLongEdge = Math.max(source.width, source.height);
  const limitMessage =
    sourceLongEdge >= ATLAS_MAX_UPSCALE_EDGE
      ? "maxReached"
      : sourceLongEdge >= targetLongEdge
        ? "targetReached"
        : null;
  return {
    sourceLongEdge,
    outputSize: resolveAtlasUpscaleSize(
      source.width,
      source.height,
      targetLongEdge,
    ),
    canUpscale:
      limitMessage === null && targetLongEdge <= ATLAS_MAX_UPSCALE_EDGE,
    limitMessage,
  };
}
