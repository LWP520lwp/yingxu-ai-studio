export const MAX_IMAGE_SPLIT_LINES = 11;

export type ImagePixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function positiveDimension(value: number) {
  return Math.max(1, Math.floor(finite(value, 1)));
}

export function normalizeCropRect(
  crop: ImagePixelRect,
  image: { width: number; height: number },
): ImagePixelRect {
  const width = positiveDimension(image.width);
  const height = positiveDimension(image.height);
  const x = Math.min(width - 1, Math.max(0, Math.floor(finite(crop.x, 0))));
  const y = Math.min(height - 1, Math.max(0, Math.floor(finite(crop.y, 0))));
  const cropWidth = Math.min(
    width - x,
    Math.max(1, Math.ceil(finite(crop.width, width))),
  );
  const cropHeight = Math.min(
    height - y,
    Math.max(1, Math.ceil(finite(crop.height, height))),
  );
  return { x, y, width: cropWidth, height: cropHeight };
}

export function normalizeSplitLines(
  lines: number[] | undefined,
  size: number,
  requestedCount: number,
) {
  const length = positiveDimension(size);
  const count = Math.min(
    length,
    MAX_IMAGE_SPLIT_LINES + 1,
    Math.max(1, Math.floor(finite(requestedCount, 1))),
  );
  if (!Array.isArray(lines) || lines.length === 0) {
    return Array.from({ length: count + 1 }, (_, index) =>
      Math.floor((index * length) / count),
    );
  }

  const interior = [
    ...new Set(
      lines
        .map((line) => Math.round(finite(line, -1) * length))
        .filter((line) => line > 0 && line < length),
    ),
  ]
    .sort((left, right) => left - right)
    .slice(0, MAX_IMAGE_SPLIT_LINES);
  return [0, ...interior, length];
}

export function resolveUpscaleDimensions(
  width: number,
  height: number,
  targetLongEdge: number,
  maximumLongEdge: number,
) {
  const sourceWidth = positiveDimension(width);
  const sourceHeight = positiveDimension(height);
  const maximum = positiveDimension(maximumLongEdge);
  const target = Math.min(
    maximum,
    Math.max(1, Math.round(finite(targetLongEdge, 1))),
  );
  const scale = target / Math.max(sourceWidth, sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function boundedAngle(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, finite(value, 0)));
}
