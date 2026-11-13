import { describe, expect, it } from "vitest";

import {
  ATLAS_DEFAULT_UPSCALE_OPTIONS,
  ATLAS_UPSCALE_ALGORITHMS,
  ATLAS_UPSCALE_TARGETS,
  deriveAtlasUpscaleState,
  initialAtlasUpscaleTarget,
  isAtlasUpscaleAlgorithm,
  isAtlasUpscaleTargetReached,
} from "@/atlas-engine/workflows/image-processing";

describe("image upscaling controls", () => {
  it("retains the three target tiers and their initial target", () => {
    expect(ATLAS_UPSCALE_TARGETS.map(({ value }) => value)).toEqual([
      1024, 2048, 4096,
    ]);
    expect(ATLAS_DEFAULT_UPSCALE_OPTIONS).toEqual({
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
    expect(initialAtlasUpscaleTarget(edge)).toBe(target);
  });

  it("preserves all three supported resize algorithms", () => {
    expect(ATLAS_UPSCALE_ALGORITHMS).toEqual(["high", "bilinear", "nearest"]);
    expect(isAtlasUpscaleAlgorithm("high")).toBe(true);
    expect(isAtlasUpscaleAlgorithm("unsupported")).toBe(false);
  });

  it("computes aspect-preserving output and enables only a larger valid target", () => {
    expect(deriveAtlasUpscaleState({ width: 1600, height: 900 }, 2048)).toEqual(
      {
        sourceLongEdge: 1600,
        outputSize: { width: 2048, height: 1152 },
        canUpscale: true,
        limitMessage: null,
      },
    );
    expect(
      deriveAtlasUpscaleState({ width: 2048, height: 1024 }, 2048),
    ).toMatchObject({ canUpscale: false, limitMessage: "targetReached" });
    expect(
      deriveAtlasUpscaleState({ width: 4096, height: 2048 }, 4096),
    ).toMatchObject({ canUpscale: false, limitMessage: "maxReached" });
    expect(
      deriveAtlasUpscaleState({ width: 100, height: 100 }, 8192),
    ).toMatchObject({
      canUpscale: false,
      outputSize: { width: 4096, height: 4096 },
    });
  });

  it("disables target tiers already met by the source image", () => {
    expect(isAtlasUpscaleTargetReached(1024, 1024)).toBe(true);
    expect(isAtlasUpscaleTargetReached(900, 1024)).toBe(false);
  });

  it("keeps the loading state non-actionable until source metadata is available", () => {
    expect(deriveAtlasUpscaleState(null, 2048)).toEqual({
      sourceLongEdge: 0,
      outputSize: null,
      canUpscale: false,
      limitMessage: null,
    });
  });
});
