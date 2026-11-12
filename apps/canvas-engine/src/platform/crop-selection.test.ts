import { describe, expect, it } from "vitest";

import {
  DEFAULT_CROP_RECT,
  fitCropToAspectRatio,
  moveCrop,
  nudgeCrop,
  cropRatio,
  resizeCrop,
  resolveCropAspectRatio,
} from "@/lib/canvas/crop-selection";

describe("crop selection geometry", () => {
  it("moves a crop rectangle without crossing the image bounds", () => {
    expect(moveCrop(DEFAULT_CROP_RECT, 1, -1)).toEqual({
      ...DEFAULT_CROP_RECT,
      x: 0.24,
      y: 0,
    });
  });

  it("supports precise and coarse keyboard nudges", () => {
    expect(nudgeCrop(DEFAULT_CROP_RECT, "right").x).toBeCloseTo(0.13);
    expect(nudgeCrop(DEFAULT_CROP_RECT, "down", true).y).toBeCloseTo(0.17);
  });

  it("resizes from the selected edge and keeps the opposite edge anchored", () => {
    const resized = resizeCrop(DEFAULT_CROP_RECT, 0.1, 0, "w", null, {
      width: 400,
      height: 400,
    });
    expect(resized.x).toBeCloseTo(0.22);
    expect(resized.width).toBeCloseTo(0.66);
    expect(resized.y).toBe(DEFAULT_CROP_RECT.y);
    expect(resized.height).toBe(DEFAULT_CROP_RECT.height);
  });

  it("keeps a requested ratio while bounding the crop to the image", () => {
    const resized = resizeCrop(DEFAULT_CROP_RECT, 0.7, 0.2, "se", 16 / 9, {
      width: 1600,
      height: 900,
    });
    expect(resized.width).toBeCloseTo(resized.height);
    expect(resized.x + resized.width).toBeLessThanOrEqual(1);
    expect(resized.y + resized.height).toBeLessThanOrEqual(1);
    expect(resized.width).toBeGreaterThan(0);
    expect(resized.height).toBeGreaterThan(0);
  });

  it("fits ratio presets inside the current crop and centers the result", () => {
    const fitted = fitCropToAspectRatio(DEFAULT_CROP_RECT, 4 / 3, {
      width: 1600,
      height: 900,
    });
    expect(fitted.width / fitted.height).toBeCloseTo(0.75);
    expect(fitted.x).toBeGreaterThan(DEFAULT_CROP_RECT.x);
    expect(fitted.y).toBeCloseTo(DEFAULT_CROP_RECT.y);
    expect(fitted.x + fitted.width / 2).toBeCloseTo(
      DEFAULT_CROP_RECT.x + DEFAULT_CROP_RECT.width / 2,
    );
    expect(
      resolveCropAspectRatio("original", { width: 1600, height: 900 }, null),
    ).toBeCloseTo(16 / 9);
    expect(
      resolveCropAspectRatio("4:3", { width: 1600, height: 900 }, null),
    ).toBeCloseTo(4 / 3);
    expect(
      resolveCropAspectRatio("fixed", { width: 1600, height: 900 }, 2),
    ).toBe(2);
    expect(
      resolveCropAspectRatio("free", { width: 1600, height: 900 }, null),
    ).toBeNull();
  });

  it("keeps extreme fixed ratios finite and inside the image bounds", () => {
    for (const ratio of [0.01, 0.05, 20, 100]) {
      const resized = resizeCrop(DEFAULT_CROP_RECT, 0.4, -0.2, "nw", ratio, {
        width: 100,
        height: 100,
      });
      expect(Number.isFinite(resized.width)).toBe(true);
      expect(Number.isFinite(resized.height)).toBe(true);
      expect(resized.x).toBeGreaterThanOrEqual(0);
      expect(resized.y).toBeGreaterThanOrEqual(0);
      expect(resized.x + resized.width).toBeLessThanOrEqual(1);
      expect(resized.y + resized.height).toBeLessThanOrEqual(1);
    }
  });

  it("reduces output dimensions to an integer ratio", () => {
    expect(cropRatio(1920, 1080)).toBe("16:9");
    expect(cropRatio(Number.NaN, 0)).toBe("1:1");
  });
});
