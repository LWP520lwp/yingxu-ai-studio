import { describe, expect, it } from "vitest";

import {
  canvasCenterInWorld,
  centeredCanvasViewport,
  clientPointToCanvas,
  zoomCanvasToScale,
} from "@/atlas-engine/host/viewport-controller";

describe("Atlas viewport controller", () => {
  it("maps client coordinates through the element origin and current view", () => {
    expect(
      clientPointToCanvas(
        { x: 450, y: 330 },
        { left: 100, top: 50 },
        { x: 50, y: 30, k: 2 },
      ),
    ).toEqual({ x: 150, y: 125 });
  });

  it("finds the visible center in world coordinates and centers a fresh view", () => {
    expect(
      canvasCenterInWorld(
        { left: 20, top: 10 },
        { width: 800, height: 600 },
        { x: 20, y: 10, k: 2 },
      ),
    ).toEqual({ x: 190, y: 145 });
    expect(centeredCanvasViewport({ width: 800, height: 600 })).toEqual({
      x: 400,
      y: 300,
      k: 1,
    });
  });

  it("keeps the viewport center anchored while applying bounded zoom", () => {
    expect(
      zoomCanvasToScale(
        { x: 200, y: 150, k: 1 },
        { width: 800, height: 600 },
        2,
      ),
    ).toEqual({ x: 0, y: 0, k: 2 });
    expect(
      zoomCanvasToScale(
        { x: 200, y: 150, k: 1 },
        { width: 800, height: 600 },
        99,
      ).k,
    ).toBe(5);
  });
});
