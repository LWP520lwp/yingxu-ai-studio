import { describe, expect, it } from "vitest";
import {
  ATLAS_ZOOM_LIMITS,
  canvasGridStyle,
  clampCanvasZoom,
  crossedPanThreshold,
  panCanvasBy,
  wheelZoomFactor,
  zoomCanvasAt,
} from "@/atlas-engine/surface/viewport";

describe("Atlas canvas viewport math", () => {
  it("keeps the world point beneath the pointer fixed while zooming", () => {
    const before = { x: 30, y: -20, k: 1.25 };
    const cursor = { x: 210, y: 150 };
    const world = { x: (cursor.x - before.x) / before.k, y: (cursor.y - before.y) / before.k };
    const after = zoomCanvasAt(before, cursor, 1.6);

    expect(after.k).toBe(2);
    expect(after.x + world.x * after.k).toBeCloseTo(cursor.x);
    expect(after.y + world.y * after.k).toBeCloseTo(cursor.y);
  });

  it("clamps zoom and does not propagate invalid values", () => {
    expect(zoomCanvasAt({ x: 0, y: 0, k: 1 }, { x: 0, y: 0 }, 100).k).toBe(ATLAS_ZOOM_LIMITS.maxScale);
    expect(zoomCanvasAt({ x: 0, y: 0, k: 1 }, { x: 0, y: 0 }, 0.001).k).toBe(ATLAS_ZOOM_LIMITS.minScale);
    expect(clampCanvasZoom(Number.NaN)).toBe(1);
    const invalid = { x: Number.NaN, y: 0, k: 1 };
    expect(zoomCanvasAt(invalid, { x: 1, y: 1 }, 2)).toBe(invalid);
    expect(panCanvasBy({ x: 1, y: 2, k: 1 }, { x: Number.POSITIVE_INFINITY, y: 0 })).toEqual({ x: 1, y: 2, k: 1 });
  });

  it("normalizes wheel zoom across pixel, line, and page wheel modes", () => {
    expect(wheelZoomFactor(100, 0, 800)).toBeLessThan(1);
    expect(wheelZoomFactor(1, 1, 800)).toBeCloseTo(wheelZoomFactor(16, 0, 800));
    expect(wheelZoomFactor(1, 2, 800)).toBeCloseTo(wheelZoomFactor(800, 0, 800));
    expect(wheelZoomFactor(Number.NaN, 0, 800)).toBe(1);
  });

  it("keeps grid phase positive when the view is panned into negative space", () => {
    const style = canvasGridStyle({ x: -50, y: -20, k: 1 }, "lines");
    expect(style?.backgroundSize).toBe("48px 48px");
    expect(style?.backgroundPosition).toBe("46px 28px");
    expect(canvasGridStyle({ x: 0, y: 0, k: 1 }, "blank")).toBeUndefined();
    expect(canvasGridStyle({ x: 0, y: 0, k: 0 }, "dots")).toBeUndefined();
  });

  it("uses a screen-space movement threshold for starting a pan", () => {
    expect(crossedPanThreshold({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false);
    expect(crossedPanThreshold({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(true);
  });
});
