import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_SPLIT_LINES,
  boundedAngle,
  normalizeCropRect,
  normalizeSplitLines,
  resolveUpscaleDimensions,
} from "@/lib/canvas/canvas-image-geometry";

describe("canvas image geometry", () => {
  it("clamps crop pixels to a non-empty rectangle inside the source", () => {
    expect(
      normalizeCropRect(
        { x: 99.2, y: -10, width: 20, height: Number.NaN },
        { width: 100, height: 60 },
      ),
    ).toEqual({ x: 99, y: 0, width: 1, height: 60 });
  });

  it("deduplicates, sorts and bounds split lines and count-derived grids", () => {
    expect(normalizeSplitLines([0.5, 0.5, -2, 1, 0.25], 100, 2)).toEqual([
      0, 25, 50, 100,
    ]);
    expect(normalizeSplitLines(undefined, 5, 100)).toEqual([0, 1, 2, 3, 4, 5]);
    const bounded = normalizeSplitLines(
      Array.from({ length: 100 }, (_, index) => index / 101),
      1000,
      2,
    );
    expect(bounded).toHaveLength(MAX_IMAGE_SPLIT_LINES + 2);
    expect(bounded[0]).toBe(0);
    expect(bounded.at(-1)).toBe(1000);
    expect(bounded.slice(1).every((line, index) => line > bounded[index])).toBe(
      true,
    );
  });

  it("returns safe upscale dimensions for invalid sizes and caps output", () => {
    expect(resolveUpscaleDimensions(0, Number.NaN, Infinity, 4096)).toEqual({
      width: 1,
      height: 1,
    });
    expect(resolveUpscaleDimensions(4000, 2000, 8000, 4096)).toEqual({
      width: 4096,
      height: 2048,
    });
  });

  it("bounds image angle settings to supported values", () => {
    expect(boundedAngle(Number.NaN, -60, 60)).toBe(0);
    expect(boundedAngle(120, -60, 60)).toBe(60);
    expect(boundedAngle(-90, -45, 45)).toBe(-45);
  });
});
