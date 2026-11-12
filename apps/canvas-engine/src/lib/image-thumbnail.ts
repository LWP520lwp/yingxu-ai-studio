export const CANVAS_IMAGE_PREVIEW_MAX_EDGE = 768;

type ImageSourceChoice = {
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
}: ImageSourceChoice) {
  if (!previewUrl) return originalUrl;

  const naturalLongEdge = Math.max(
    positiveOrZero(naturalWidth),
    positiveOrZero(naturalHeight),
  );
  const maxPreviewEdge = positiveOrDefault(
    previewMaxEdge,
    CANVAS_IMAGE_PREVIEW_MAX_EDGE,
  );
  const previewLongEdge =
    naturalLongEdge > 0
      ? Math.min(maxPreviewEdge, naturalLongEdge)
      : maxPreviewEdge;
  const displayScale = positiveOrDefault(scale, 1);
  const pixelRatio = positiveOrDefault(devicePixelRatio, 1);
  const requiredLongEdge =
    Math.max(positiveOrZero(renderedWidth), positiveOrZero(renderedHeight)) *
    displayScale *
    pixelRatio;

  return requiredLongEdge > previewLongEdge ? originalUrl : previewUrl;
}

export function getThumbnailDimensions(
  width: number,
  height: number,
  maxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE,
) {
  const sourceWidth = Math.max(1, positiveOrDefault(width, 1));
  const sourceHeight = Math.max(1, positiveOrDefault(height, 1));
  const edgeLimit = positiveOrDefault(maxEdge, CANVAS_IMAGE_PREVIEW_MAX_EDGE);
  const factor = Math.min(1, edgeLimit / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * factor)),
    height: Math.max(1, Math.round(sourceHeight * factor)),
  };
}

export async function createImageThumbnail(
  blob: Blob,
  maxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE,
) {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = getThumbnailDimensions(
    bitmap.width,
    bitmap.height,
    maxEdge,
  );
  if (width === bitmap.width && height === bitmap.height) {
    bitmap.close();
    return undefined;
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob | undefined>((resolve, reject) => {
      try {
        canvas.toBlob(
          (result) => resolve(result || undefined),
          "image/webp",
          0.86,
        );
      } catch (error) {
        reject(error);
      }
    });
  } finally {
    bitmap.close();
  }
}

function positiveOrZero(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function positiveOrDefault(value: number | undefined, fallback: number) {
  const number = positiveOrZero(value);
  return number || fallback;
}
