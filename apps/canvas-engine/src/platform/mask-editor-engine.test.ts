import { describe, expect, it } from "vitest";

import {
  ATLAS_MASK_BRUSH_MAX,
  ATLAS_MASK_BRUSH_MIN,
  clampAtlasMaskBrushSize,
  mapAtlasMaskPoint,
} from "@/atlas-engine/workflows/mask-raster";

describe("mask editor geometry", () => {
  it("maps pointer coordinates into source-image pixels", () => {
    expect(
      mapAtlasMaskPoint(
        150,
        250,
        { left: 100, top: 200, width: 100, height: 200 },
        { width: 1000, height: 800 },
      ),
    ).toEqual({ x: 500, y: 200 });
  });

  it("clamps and snaps brush sizes to the supported even-pixel range", () => {
    expect(clampAtlasMaskBrushSize(-10)).toBe(ATLAS_MASK_BRUSH_MIN);
    expect(clampAtlasMaskBrushSize(11)).toBe(12);
    expect(clampAtlasMaskBrushSize(999)).toBe(ATLAS_MASK_BRUSH_MAX);
    expect(clampAtlasMaskBrushSize(Number.NaN)).toBe(ATLAS_MASK_BRUSH_MIN);
    expect(clampAtlasMaskBrushSize(Number.POSITIVE_INFINITY)).toBe(
      ATLAS_MASK_BRUSH_MIN,
    );
  });
});
