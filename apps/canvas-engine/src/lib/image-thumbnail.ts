export const CANVAS_IMAGE_PREVIEW_MAX_EDGE = 768;

type PreviewChoice = {
  previewUrl?: string;
  originalUrl: string;
  naturalWidth?: number;
  naturalHeight?: number;
  renderedWidth: number;
  renderedHeight: number;
  scale: number;
  devicePixelRatio?: number;
  previewMaxEdge?: number;
};

type ThumbnailEncoding = {
  mimeType?: "image/webp" | "image/jpeg";
  quality?: number;
};

const positive = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

const positiveOr = (value: number | undefined, fallback: number) =>
  positive(value) || fallback;

export function pickImageSource({
  previewUrl,
  originalUrl,
  naturalWidth,
  naturalHeight,
  renderedWidth,
  renderedHeight,
  scale,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  previewMaxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE,
}: PreviewChoice) {
  if (!previewUrl) return originalUrl;

  const actualLongEdge = Math.max(
    positive(naturalWidth),
    positive(naturalHeight),
  );
  const previewLongEdge = Math.min(
    positiveOr(previewMaxEdge, CANVAS_IMAGE_PREVIEW_MAX_EDGE),
    actualLongEdge || positiveOr(previewMaxEdge, CANVAS_IMAGE_PREVIEW_MAX_EDGE),
  );
  const requiredPixels =
    Math.max(positive(renderedWidth), positive(renderedHeight)) *
    positiveOr(scale, 1) *
    positiveOr(devicePixelRatio, 1);

  return requiredPixels > previewLongEdge ? originalUrl : previewUrl;
}

export function getThumbnailDimensions(
  width: number,
  height: number,
  maxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE,
) {
  const sourceWidth = Math.max(1, positiveOr(width, 1));
  const sourceHeight = Math.max(1, positiveOr(height, 1));
  const bound = positiveOr(maxEdge, CANVAS_IMAGE_PREVIEW_MAX_EDGE);
  const ratio = Math.min(1, bound / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio)),
  };
}

export async function createImageThumbnail(
  blob: Blob,
  maxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE,
  encoding: ThumbnailEncoding = {},
) {
  if (typeof createImageBitmap !== "function") return undefined;
  const bitmap = await createImageBitmap(blob);
  try {
    const target = getThumbnailDimensions(bitmap.width, bitmap.height, maxEdge);
    if (target.width === bitmap.width && target.height === bitmap.height)
      return undefined;

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return undefined;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    return await canvasBlob(
      canvas,
      encoding.mimeType || "image/webp",
      clampQuality(encoding.quality),
    );
  } finally {
    bitmap.close();
  }
}

function clampQuality(value: number | undefined) {
  return Math.min(1, Math.max(0.1, positiveOr(value, 0.86)));
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
) {
  return new Promise<Blob | undefined>((resolve, reject) => {
    try {
      canvas.toBlob(
        (result) => resolve(result || undefined),
        mimeType,
        quality,
      );
    } catch (error) {
      reject(error);
    }
  });
}
