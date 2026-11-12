export type CanvasImageCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CropImageSize = { width: number; height: number };
export type CropStageSize = { width: number; height: number };
export type CropResizeHandle =
  "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

export const DEFAULT_CROP_RECT: CanvasImageCropRect = {
  x: 0.12,
  y: 0.12,
  width: 0.76,
  height: 0.76,
};

export const CROP_RESIZE_HANDLES: CropResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

export const CROP_MIN_SIZE = 0.06;

export function moveCrop(
  crop: CanvasImageCropRect,
  dx: number,
  dy: number,
): CanvasImageCropRect {
  return {
    ...crop,
    x: clamp(crop.x + finite(dx), 0, 1 - crop.width),
    y: clamp(crop.y + finite(dy), 0, 1 - crop.height),
  };
}

export function resizeCrop(
  crop: CanvasImageCropRect,
  dx: number,
  dy: number,
  handle: CropResizeHandle,
  aspectRatio: number | null,
  stage: CropStageSize,
): CanvasImageCropRect {
  const deltaX = finite(dx);
  const deltaY = finite(dy);
  const stageWidth = Math.max(1, finite(stage.width, 1));
  const stageHeight = Math.max(1, finite(stage.height, 1));
  let width = crop.width;
  let height = crop.height;

  if (handle.includes("e")) width += deltaX;
  if (handle.includes("s")) height += deltaY;
  if (handle.includes("w")) width -= deltaX;
  if (handle.includes("n")) height -= deltaY;

  let next: CanvasImageCropRect;
  if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    const normalizedRatio = aspectRatio * (stageHeight / stageWidth);
    const horizontalOnly =
      (handle.includes("e") || handle.includes("w")) &&
      !handle.includes("n") &&
      !handle.includes("s");
    const useWidth =
      horizontalOnly ||
      (handle.length > 1 &&
        Math.abs(deltaX * stageWidth) >= Math.abs(deltaY * stageHeight));
    const requestedHeight = useWidth ? width / normalizedRatio : height;
    const maxHeight = Math.min(1, 1 / normalizedRatio);
    const minHeight = Math.min(
      maxHeight,
      CROP_MIN_SIZE / Math.min(1, normalizedRatio),
    );
    height = clamp(requestedHeight, minHeight, maxHeight);
    width = height * normalizedRatio;
    next = { ...crop, width, height };
  } else {
    width = clamp(width, CROP_MIN_SIZE, 1);
    height = clamp(height, CROP_MIN_SIZE, 1);
    next = { ...crop, width, height };
  }

  if (handle.includes("w")) next.x = crop.x + crop.width - next.width;
  if (handle.includes("n")) next.y = crop.y + crop.height - next.height;
  next.x = clamp(next.x, 0, 1 - next.width);
  next.y = clamp(next.y, 0, 1 - next.height);
  return next;
}

export function resolveCropAspectRatio(
  preset: string,
  image: CropImageSize | null,
  fixedRatio: number | null,
): number | null {
  if (preset === "free" || !image) return null;
  if (preset === "fixed") return fixedRatio;
  if (preset === "original") return image.width / image.height;
  const [width, height] = preset.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : null;
}

export function fitCropToAspectRatio(
  crop: CanvasImageCropRect,
  aspectRatio: number,
  image: CropImageSize,
): CanvasImageCropRect {
  if (
    !Number.isFinite(aspectRatio) ||
    aspectRatio <= 0 ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    return crop;
  }

  const normalizedRatio = aspectRatio * (image.height / image.width);
  const currentWidth = clamp(finite(crop.width), 0, 1);
  const currentHeight = clamp(finite(crop.height), 0, 1);
  let width = currentWidth;
  let height = width / normalizedRatio;

  if (height > currentHeight) {
    height = currentHeight;
    width = height * normalizedRatio;
  }
  if (width > 1) {
    width = 1;
    height = width / normalizedRatio;
  }
  if (height > 1) {
    height = 1;
    width = height * normalizedRatio;
  }

  return {
    x: clamp(crop.x + (crop.width - width) / 2, 0, 1 - width),
    y: clamp(crop.y + (crop.height - height) / 2, 0, 1 - height),
    width,
    height,
  };
}

export function nudgeCrop(
  crop: CanvasImageCropRect,
  direction: "up" | "down" | "left" | "right",
  coarse = false,
): CanvasImageCropRect {
  const distance = coarse ? 0.05 : 0.01;
  const offsets = {
    up: [0, -distance],
    down: [0, distance],
    left: [-distance, 0],
    right: [distance, 0],
  } as const;
  const [dx, dy] = offsets[direction];
  return moveCrop(crop, dx, dy);
}

export function cropRatio(width: number, height: number): string {
  const safeWidth = Math.max(1, Math.round(finite(width)));
  const safeHeight = Math.max(1, Math.round(finite(height)));
  const divisor = greatestCommonDivisor(safeWidth, safeHeight);
  return `${safeWidth / divisor}:${safeHeight / divisor}`;
}

export function cropHandleStyle(handle: CropResizeHandle) {
  const offset = "calc(50% - 12px)";
  const edgeOffset = "-12px";
  return {
    top: handle.includes("n")
      ? edgeOffset
      : handle.includes("s")
        ? `calc(100% - 12px)`
        : offset,
    left: handle.includes("w")
      ? edgeOffset
      : handle.includes("e")
        ? `calc(100% - 12px)`
        : offset,
    cursor: `${handle}-resize`,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b ? greatestCommonDivisor(b, a % b) : Math.max(1, a);
}
