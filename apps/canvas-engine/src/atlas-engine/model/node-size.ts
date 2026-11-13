const STANDARD_LIMIT = 640;
const ABSOLUTE_LIMIT = 1_000_000;
const MIN_EXTENT = 1;

export type AtlasSize = Readonly<{ width: number; height: number }>;

function positiveExtent(value: number, fallback = MIN_EXTENT): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, ABSOLUTE_LIMIT) : fallback;
}

function safeLimit(value: number, fallback: number): number {
  if (value === Number.POSITIVE_INFINITY) return ABSOLUTE_LIMIT;
  return Number.isFinite(value) && value > 0
    ? Math.min(value, ABSOLUTE_LIMIT)
    : fallback;
}

export function fitAtlasNodeSize(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth = STANDARD_LIMIT,
  maxHeight = STANDARD_LIMIT,
): AtlasSize {
  const width = positiveExtent(sourceWidth);
  const height = positiveExtent(sourceHeight);
  const limitWidth = safeLimit(maxWidth, STANDARD_LIMIT);
  const limitHeight = safeLimit(maxHeight, STANDARD_LIMIT);
  const ratio = Math.min(1, limitWidth / width, limitHeight / height);

  return {
    width: Math.max(MIN_EXTENT, Math.min(limitWidth, width * ratio)),
    height: Math.max(MIN_EXTENT, Math.min(limitHeight, height * ratio)),
  };
}

export function atlasNodeSizeFromRatio(
  ratioText: string,
  baseWidth: number,
  baseHeight: number,
): AtlasSize | null {
  const match = ratioText?.trim().match(/^(\d+(?:\.\d+)?)\s*(?:x|:)\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return null;

  const ratioWidth = Number(match[1]);
  const ratioHeight = Number(match[2]);
  if (ratioWidth <= 0 || ratioHeight <= 0 || !Number.isFinite(ratioWidth / ratioHeight)) return null;

  const width = positiveExtent(baseWidth);
  const height = positiveExtent(baseHeight);
  const ratio = ratioWidth / ratioHeight;
  if (ratio < 0.25 || ratio > 4) return { width, height };

  return ratio >= width / height
    ? { width, height: Math.max(MIN_EXTENT, width / ratio) }
    : { width: Math.max(MIN_EXTENT, height * ratio), height };
}

// Compatibility names are kept while existing UI call sites move to Atlas APIs.
export const fitNodeSize = fitAtlasNodeSize;
export const nodeSizeFromRatio = atlasNodeSizeFromRatio;
