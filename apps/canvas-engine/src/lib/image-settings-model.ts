import {
  computeMediaSize,
  inferMediaRatio,
  inferMediaScale,
  readMediaDimensions,
} from "@/lib/media-size";

const DIMENSION_ALIGNMENT = 16;

export function readImageSettings(size = "auto") {
  const scale = inferMediaScale(size);
  const ratio = inferMediaRatio(size);
  return {
    scale,
    ratio,
    dimensions: readMediaDimensions(size, scale, ratio),
    dimensionsEditable: ratio !== "auto",
  };
}

export function selectImageScale(currentSize: string, nextScale: string) {
  const { ratio } = readImageSettings(currentSize);
  return computeMediaSize(nextScale, ratio === "auto" ? "1:1" : ratio);
}

export function selectImageRatio(currentSize: string, nextRatio: string) {
  return computeMediaSize(inferMediaScale(currentSize), nextRatio);
}

export function updateImageDimension(
  currentSize: string,
  edge: "width" | "height",
  input: number,
  alignToStep: boolean,
) {
  const { dimensions } = readImageSettings(currentSize);
  const next =
    Number.isFinite(input) && input !== 0 ? input : dimensions[edge] || 1024;
  const width = edge === "width" ? next : dimensions.width;
  const height = edge === "height" ? next : dimensions.height;
  return `${alignImageDimension(width, alignToStep)}x${alignImageDimension(height, alignToStep)}`;
}

export function normalizeImageCount(value: unknown, maxCount = 15) {
  const upperBound = normalizeLimit(maxCount, 1);
  const numeric = Number(value);
  const wholeCount = Number.isFinite(numeric)
    ? Math.floor(Math.abs(numeric))
    : 1;
  return Math.max(1, Math.min(upperBound, wholeCount || 1));
}

export function getQuickImageCounts(quickCount = 10, maxCount = 15) {
  const upperBound = normalizeLimit(maxCount, 1);
  const requestedCount = Number.isFinite(quickCount)
    ? Math.max(0, Math.floor(quickCount))
    : upperBound;
  const optionCount = Math.min(requestedCount, upperBound);
  return Array.from({ length: optionCount }, (_, index) => index + 1);
}

export function alignImageDimension(value: number, enabled: boolean) {
  const positiveValue = Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : 1;
  return enabled
    ? Math.ceil(positiveValue / DIMENSION_ALIGNMENT) * DIMENSION_ALIGNMENT
    : positiveValue;
}

function normalizeLimit(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : Math.max(1, Math.floor(fallback));
}
