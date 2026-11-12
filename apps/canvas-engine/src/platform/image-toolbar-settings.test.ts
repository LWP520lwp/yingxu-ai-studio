import { describe, expect, it } from "vitest";

import {
  measurePreviewScroll,
  previewScrollbarThumbWidth,
} from "@/lib/canvas/image-toolbar-settings";

describe("image toolbar preview scroll", () => {
  it("bounds scroll position to the available horizontal range", () => {
    expect(measurePreviewScroll(500, 800, 300)).toEqual({
      left: 500,
      max: 500,
      viewport: 300,
      content: 800,
    });
    expect(measurePreviewScroll(-12, 80, 200).left).toBe(0);
    expect(measurePreviewScroll(100, 80, 200).left).toBe(0);
  });

  it("normalizes invalid dimensions without producing NaN scroll controls", () => {
    expect(
      measurePreviewScroll(Number.NaN, Number.POSITIVE_INFINITY, -10),
    ).toEqual({
      left: 0,
      max: 0,
      viewport: 1,
      content: 1,
    });
  });

  it("keeps the scrollbar thumb proportional with a usable minimum size", () => {
    expect(previewScrollbarThumbWidth(240, 100, 400, true)).toBe(64);
    expect(previewScrollbarThumbWidth(240, 200, 400, true)).toBe(120);
    expect(previewScrollbarThumbWidth(48, 1, 1000, true)).toBe(48);
    expect(previewScrollbarThumbWidth(240, 1, 1000, false)).toBe(240);
  });
});
