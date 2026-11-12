import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_UPSCALE_PARAMS,
  IMAGE_UPSCALE_ALGORITHMS,
  IMAGE_UPSCALE_TARGETS,
  deriveImageUpscaleState,
  initialUpscaleTarget,
  isImageUpscaleAlgorithm,
  isUpscaleTargetReached,
} from "@/lib/canvas/canvas-image-upscale";

describe("image upscaling controls", () => {
  it("retains the three target tiers and their initial target", () => {
    expect(IMAGE_UPSCALE_TARGETS.map(({ value }) => value)).toEqual([
      1024, 2048, 4096,
    ]);
    expect(DEFAULT_IMAGE_UPSCALE_PARAMS).toEqual({
      targetLongEdge: 2048,
      algorithm: "high",
    });
  });

  it.each([
    [800, 1024],
    [1024, 2048],
    [2048, 4096],
    [4096, 4096],
    [5000, 4096],
  ])("selects the first target larger than source edge %i", (edge, target) => {
    expect(initialUpscaleTarget(edge)).toBe(target);
  });

  it("preserves all three supported resize algorithms", () => {
    expect(IMAGE_UPSCALE_ALGORITHMS).toEqual(["high", "bilinear", "nearest"]);
    expect(isImageUpscaleAlgorithm("high")).toBe(true);
    expect(isImageUpscaleAlgorithm("unsupported")).toBe(false);
  });

  it("computes aspect-preserving output and enables only a larger valid target", () => {
    expect(deriveImageUpscaleState({ width: 1600, height: 900 }, 2048)).toEqual(
      {
        sourceLongEdge: 1600,
        outputSize: { width: 2048, height: 1152 },
        canUpscale: true,
        limitMessage: null,
      },
    );
    expect(
      deriveImageUpscaleState({ width: 2048, height: 1024 }, 2048),
    ).toMatchObject({ canUpscale: false, limitMessage: "targetReached" });
    expect(
      deriveImageUpscaleState({ width: 4096, height: 2048 }, 4096),
    ).toMatchObject({ canUpscale: false, limitMessage: "maxReached" });
    expect(
      deriveImageUpscaleState({ width: 100, height: 100 }, 8192),
    ).toMatchObject({
      canUpscale: false,
      outputSize: { width: 4096, height: 4096 },
    });
  });

  it("disables target tiers already met by the source image", () => {
    expect(isUpscaleTargetReached(1024, 1024)).toBe(true);
    expect(isUpscaleTargetReached(900, 1024)).toBe(false);
  });

  it("keeps the loading state non-actionable until source metadata is available", () => {
    expect(deriveImageUpscaleState(null, 2048)).toEqual({
      sourceLongEdge: 0,
      outputSize: null,
      canUpscale: false,
      limitMessage: null,
    });
  });
});
