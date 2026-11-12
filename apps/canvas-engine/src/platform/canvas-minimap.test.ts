import { describe, expect, it } from "vitest";

import {
  createMinimapLayout,
  minimapConnectionPath,
  minimapNodeRect,
  minimapToWorld,
  minimapViewportRect,
  viewportAtMinimapPoint,
  worldToMinimap,
} from "@/lib/canvas/canvas-minimap";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, x: number, y: number): CanvasNodeData => ({
  id,
  type: CanvasNodeType.Image,
  title: id,
  position: { x, y },
  width: 200,
  height: 100,
  metadata: {},
});

describe("canvas minimap geometry", () => {
  it("maps world points to the mini view and back", () => {
    const layout = createMinimapLayout([node("a", 100, -50)]);
    const world = { x: 250, y: 125 };
    expect(minimapToWorld(worldToMinimap(world, layout), layout)).toEqual(
      world,
    );
  });

  it("computes a stable fallback layout and bounded node frames", () => {
    const layout = createMinimapLayout([]);
    expect(layout).toMatchObject({
      width: 240,
      height: 160,
      world: { x: -500, y: -500, width: 1000, height: 1000 },
      scale: 0.16,
      offset: { x: 40, y: 0 },
    });
    expect(minimapNodeRect(node("a", 100, 50), layout)).toEqual({
      x: 136,
      y: 88,
      width: 32,
      height: 16,
    });
  });

  it("draws only connections whose endpoints still exist", () => {
    const nodes = [node("a", 0, 0), node("b", 600, 300)];
    const layout = createMinimapLayout(nodes);
    const path = minimapConnectionPath(
      nodes,
      [
        { id: "valid", fromNodeId: "a", toNodeId: "b" },
        { id: "stale", fromNodeId: "a", toNodeId: "missing" },
      ],
      layout,
    );
    expect(path.match(/M/g)).toHaveLength(1);
    expect(path).toContain("L");
  });

  it("converts pointer positions to viewport centers and renders a minimum visible frame", () => {
    const layout = createMinimapLayout([node("a", 0, 0)]);
    const viewport = { x: -120, y: -70, k: 1.5 };
    const viewportSize = { width: 1000, height: 700 };
    const centered = viewportAtMinimapPoint(
      worldToMinimap({ x: 300, y: 240 }, layout),
      viewport,
      viewportSize,
      layout,
    );
    expect(centered).toEqual({ x: 50, y: -10, k: 1.5 });
    expect(
      minimapViewportRect(viewport, { width: 0, height: 0 }, layout),
    ).toMatchObject({ width: 4, height: 4 });
  });
});
