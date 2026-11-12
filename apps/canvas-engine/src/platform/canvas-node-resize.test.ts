import { describe, expect, it } from "vitest";

import {
  resizeCanvasNode,
  type CanvasNodeResizeInput,
} from "@/lib/canvas/canvas-node-resize";

const base: CanvasNodeResizeInput = {
  corner: "bottom-right",
  pointerStart: { x: 100, y: 100 },
  pointerNow: { x: 100, y: 100 },
  position: { x: 20, y: 30 },
  size: { width: 300, height: 200 },
  scale: 1,
  keepRatio: false,
};

describe("resizeCanvasNode", () => {
  it("resizes from the pointer delta in world coordinates", () => {
    expect(
      resizeCanvasNode({ ...base, scale: 2, pointerNow: { x: 160, y: 140 } }),
    ).toEqual({
      position: { x: 20, y: 30 },
      width: 330,
      height: 220,
    });
  });

  it.each([
    ["top-left", { pointer: { x: 80, y: 70 }, position: { x: 0, y: 0 } }],
    ["top-right", { pointer: { x: 120, y: 70 }, position: { x: 20, y: 0 } }],
    ["bottom-left", { pointer: { x: 80, y: 130 }, position: { x: 0, y: 30 } }],
  ] as const)(
    "keeps the opposite anchor fixed when dragging %s",
    (corner, expectedPosition) => {
      const result = resizeCanvasNode({
        ...base,
        corner,
        pointerNow: expectedPosition.pointer,
      });
      expect(result.width).toBe(320);
      expect(result.height).toBe(230);
      expect(result.position).toEqual(expectedPosition.position);
    },
  );

  it("preserves aspect ratio and enforces both minimum dimensions", () => {
    const result = resizeCanvasNode({
      ...base,
      keepRatio: true,
      ratio: 1.5,
      pointerNow: { x: 100, y: 0 },
    });
    expect(result.width).toBe(240);
    expect(result.height).toBe(160);
    expect(result.width / result.height).toBe(1.5);
  });

  it("uses the height delta when it is the stronger ratio-locked movement", () => {
    const result = resizeCanvasNode({
      ...base,
      keepRatio: true,
      ratio: 2,
      pointerNow: { x: 110, y: 180 },
    });
    expect(result).toMatchObject({ width: 560, height: 280 });
  });

  it("normalizes invalid scale, ratio, size, and pointer inputs to finite bounded results", () => {
    for (const result of [
      resizeCanvasNode({
        ...base,
        scale: Number.NaN,
        pointerNow: { x: Infinity, y: Number.NaN },
      }),
      resizeCanvasNode({
        ...base,
        keepRatio: true,
        ratio: Number.POSITIVE_INFINITY,
        size: { width: -1, height: Number.NaN },
        position: { x: Infinity, y: Number.NaN },
        pointerStart: { x: NaN, y: 0 },
        pointerNow: { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
      }),
    ]) {
      expect(Number.isFinite(result.position.x)).toBe(true);
      expect(Number.isFinite(result.position.y)).toBe(true);
      expect(Number.isFinite(result.width)).toBe(true);
      expect(Number.isFinite(result.height)).toBe(true);
      expect(result.width).toBeGreaterThanOrEqual(220);
      expect(result.height).toBeGreaterThanOrEqual(160);
      expect(result.width).toBeLessThanOrEqual(1_000_000);
      expect(result.height).toBeLessThanOrEqual(1_000_000);
    }
  });
});
