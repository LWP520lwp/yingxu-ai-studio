import { describe, expect, it } from "vitest";
import { edgePath, nearestPort, screenToWorld, worldToScreen, zoomAround } from "@/atlas-engine/surface/geometry";
import type { AtlasNode } from "@/atlas-engine/surface/model";

const left: AtlasNode = { id: "left", kind: "text", title: "Left", position: { x: 10, y: 20 }, width: 200, height: 100 };
const right: AtlasNode = { id: "right", kind: "image", title: "Right", position: { x: 440, y: 80 }, width: 220, height: 140 };

describe("atlas surface geometry", () => {
  it("routes an edge between explicit ports", () => {
    const path = edgePath({ id: "e", from: left.id, to: right.id, fromPort: "right", toPort: "left" }, left, right);
    expect(path).toMatch(/^M 210 70 C /);
    expect(path.endsWith("440 150")).toBe(true);
  });

  it("round-trips screen and world coordinates", () => {
    const viewport = { x: 90, y: -30, scale: 1.5 };
    const world = screenToWorld(viewport, { x: 240, y: 120 });
    expect(worldToScreen(viewport, world)).toEqual({ x: 240, y: 120 });
  });

  it("keeps the zoom anchor stable and clamps scale", () => {
    const before = { x: 20, y: 30, scale: 1 };
    const after = zoomAround(before, { x: 100, y: 80 }, 2);
    expect(after.scale).toBe(2);
    expect(after.x).toBe(-60);
    expect(after.y).toBe(-20);
    expect(zoomAround(before, { x: 0, y: 0 }, 100).scale).toBe(4);
  });

  it("finds the nearest connector within the hit radius", () => {
    expect(nearestPort(left, { x: 210, y: 70 })).toBe("right");
    expect(nearestPort(left, { x: 500, y: 500 })).toBeUndefined();
  });
});
