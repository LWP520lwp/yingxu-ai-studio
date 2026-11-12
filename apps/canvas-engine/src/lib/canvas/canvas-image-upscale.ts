import {
  MAX_UPSCALE_LONG_EDGE,
  resolveUpscaleSize,
  type ImageUpscaleAlgorithm,
} from "@/lib/canvas/canvas-image-data";

export type UpscaleSourceSize = { width: number; height: number };
export type UpscaleLimitMessage = "maxReached" | "targetReached";

export const IMAGE_UPSCALE_TARGETS = [
  { label: "1K", value: 1024 },
  { label: "2K", value: 2048 },
  { label: "4K", value: MAX_UPSCALE_LONG_EDGE },
] as const;

export const IMAGE_UPSCALE_ALGORITHMS: readonly ImageUpscaleAlgorithm[] = [
  "high",
  "bilinear",
  "nearest",
];

export const DEFAULT_IMAGE_UPSCALE_PARAMS = {
  targetLongEdge: 2048,
  algorithm: "high",
} as const;

export function initialUpscaleTarget(sourceLongEdge: number): number {
  return (
    IMAGE_UPSCALE_TARGETS.find(({ value }) => sourceLongEdge < value)?.value ??
    MAX_UPSCALE_LONG_EDGE
  );
}

export function isImageUpscaleAlgorithm(
  value: string,
): value is ImageUpscaleAlgorithm {
  return IMAGE_UPSCALE_ALGORITHMS.some((algorithm) => algorithm === value);
}

export function deriveImageUpscaleState(
  source: UpscaleSourceSize | null,
  targetLongEdge: number,
) {
  if (!source) {
    return {
      sourceLongEdge: 0,
      outputSize: null,
      canUpscale: false,
      limitMessage: null,
    };
  }

  const sourceLongEdge = Math.max(source.width, source.height);
  const limitMessage: UpscaleLimitMessage | null =
    sourceLongEdge >= MAX_UPSCALE_LONG_EDGE
      ? "maxReached"
      : sourceLongEdge >= targetLongEdge
        ? "targetReached"
        : null;

  return {
    sourceLongEdge,
    outputSize: resolveUpscaleSize(source.width, source.height, targetLongEdge),
    canUpscale:
      limitMessage === null && targetLongEdge <= MAX_UPSCALE_LONG_EDGE,
    limitMessage,
  };
}

export function isUpscaleTargetReached(
  sourceLongEdge: number,
  targetLongEdge: number,
) {
  return sourceLongEdge >= targetLongEdge;
}
