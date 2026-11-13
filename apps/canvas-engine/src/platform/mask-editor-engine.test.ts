import { describe, expect, it } from "vitest";

import {
  ATLAS_MASK_BRUSH_MAX,
  ATLAS_MASK_BRUSH_MIN,
  clampAtlasMaskBrushSize,
  mapAtlasMaskPoint,
} from "@/atlas-engine/workflows/mask-raster";
import {
  appendAtlasMaskPointerPoint,
  beginAtlasMaskPointer,
  finishAtlasMaskPointer,
} from "@/atlas-engine/workflows/mask-pointer";

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
  });
});

describe("mask pointer session", () => {
  it("ignores unrelated pointers and commits the final pointer-up point", () => {
    const session = beginAtlasMaskPointer(7, "paint", 20, { x: 1, y: 2 });

    expect(appendAtlasMaskPointerPoint(session, 8, { x: 10, y: 20 })).toBe(
      false,
    );
    expect(session.stroke.points).toEqual([{ x: 1, y: 2 }]);
    expect(appendAtlasMaskPointerPoint(session, 7, { x: 4, y: 5 })).toBe(
      true,
    );

    const result = finishAtlasMaskPointer(session, 7, "up", { x: 8, y: 9 });
    expect(result.session).toBeNull();
    expect(result.stroke?.points).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 5 },
      { x: 8, y: 9 },
    ]);
  });

  it("ends on pointer cancellation without adding a synthetic endpoint", () => {
    const session = beginAtlasMaskPointer(3, "erase", 12, { x: 2, y: 6 });
    const result = finishAtlasMaskPointer(session, 3, "cancel", {
      x: 100,
      y: 200,
    });

    expect(result.session).toBeNull();
    expect(result.stroke?.points).toEqual([{ x: 2, y: 6 }]);
  });

  it("keeps a session intact when a different pointer ends", () => {
    const session = beginAtlasMaskPointer(9, "paint", 16, { x: 1, y: 1 });
    expect(finishAtlasMaskPointer(session, 10, "up")).toEqual({
      session,
      stroke: null,
    });
  });
});
