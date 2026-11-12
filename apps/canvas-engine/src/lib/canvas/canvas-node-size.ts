const DEFAULT_BOUND = 640;
const MAX_BOUND = 1_000_000;
const MIN_SIZE = 1;

function sourceDimension(value: number) {
    return Number.isFinite(value) && value > 0 ? value : MIN_SIZE;
}

function outputBound(value: number, fallback: number) {
    if (value === Number.POSITIVE_INFINITY) return MAX_BOUND;
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(value, MAX_BOUND);
}

function boundedBaseDimension(value: number) {
    return Number.isFinite(value) && value > 0 ? Math.min(value, MAX_BOUND) : MIN_SIZE;
}

/** Fit media dimensions inside a rectangle while keeping their aspect ratio. */
export function fitNodeSize(width: number, height: number, maxWidth = DEFAULT_BOUND, maxHeight = DEFAULT_BOUND) {
    const w = sourceDimension(width);
    const h = sourceDimension(height);
    const boundWidth = outputBound(maxWidth, DEFAULT_BOUND);
    const boundHeight = outputBound(maxHeight, DEFAULT_BOUND);
    const scale = Math.min(1, boundWidth / w, boundHeight / h);

    return {
        width: Math.max(MIN_SIZE, Math.min(boundWidth, w * scale)),
        height: Math.max(MIN_SIZE, Math.min(boundHeight, h * scale)),
    };
}

/** Place a requested aspect ratio inside the node's existing size rectangle. */
export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.trim().match(/^(\d+(?:\.\d+)?)\s*(?:x|:)\s*(\d+(?:\.\d+)?)$/i);
    if (!match) return null;

    const ratioWidth = Number(match[1]);
    const ratioHeight = Number(match[2]);
    if (!Number.isFinite(ratioWidth) || !Number.isFinite(ratioHeight) || ratioWidth <= 0 || ratioHeight <= 0) return null;

    const ratio = ratioWidth / ratioHeight;
    const width = boundedBaseDimension(baseWidth);
    const height = boundedBaseDimension(baseHeight);
    if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4) return { width, height };

    return ratio >= width / height
        ? { width, height: Math.max(MIN_SIZE, width / ratio) }
        : { width: Math.max(MIN_SIZE, height * ratio), height };
}
