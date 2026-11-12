import { describe, expect, it } from "vitest";

import {
  alignImageDimension,
  getQuickImageCounts,
  normalizeImageCount,
  readImageSettings,
  selectImageRatio,
  selectImageScale,
  updateImageDimension,
} from "@/lib/image-settings-model";

describe("image settings model", () => {
  it("switches automatic size to square when a resolution is selected", () => {
    expect(selectImageScale("auto", "2k")).toBe("2048x2048");
    expect(selectImageScale("9:16", "4k")).toBe("2160x3840");
    expect(selectImageRatio("2048x2048", "16:9")).toBe("2048x1152");
    expect(selectImageRatio("auto", "16:9")).toBe("16:9");
  });

  it("preserves the untouched dimension and supports unaligned custom pixels", () => {
    expect(updateImageDimension("1024x768", "width", 1030, true)).toBe(
      "1040x768",
    );
    expect(updateImageDimension("1024x768", "height", 777, false)).toBe(
      "1024x777",
    );
    expect(updateImageDimension("1024x768", "height", Number.NaN, true)).toBe(
      "1024x768",
    );
    expect(readImageSettings("auto").dimensionsEditable).toBe(false);
    expect(readImageSettings("16:9").dimensionsEditable).toBe(true);
  });

  it("keeps image count within a positive integer limit", () => {
    expect(normalizeImageCount(undefined)).toBe(1);
    expect(normalizeImageCount("3.8", 8)).toBe(3);
    expect(normalizeImageCount(-4, 8)).toBe(4);
    expect(normalizeImageCount("99", 8)).toBe(8);
    expect(normalizeImageCount("invalid", 0)).toBe(1);
  });

  it("limits quick count presets to the configured maximum", () => {
    expect(getQuickImageCounts(10, 4)).toEqual([1, 2, 3, 4]);
    expect(getQuickImageCounts(2, 8)).toEqual([1, 2]);
    expect(getQuickImageCounts(0, 8)).toEqual([]);
  });

  it("rounds custom dimensions up to the next multiple of sixteen", () => {
    expect(alignImageDimension(1025, true)).toBe(1040);
    expect(alignImageDimension(1024, true)).toBe(1024);
    expect(alignImageDimension(1025, false)).toBe(1025);
    expect(alignImageDimension(-5, true)).toBe(16);
  });
});
