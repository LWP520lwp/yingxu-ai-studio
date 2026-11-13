import { describe, expect, it } from "vitest";
import {
  studioNodeEditingView,
  studioNodePlacement,
} from "@/atlas-engine/studio/studio-node-placement";
import { makeStudioNode } from "@/atlas-engine/studio/studio-document";

const viewport = { x: 0, y: 0, k: 1 };
const canvas = { width: 1000, height: 800 };
const node = (x: number, y: number, width = 260, height = 150) => ({
  ...makeStudioNode("image", x, y, "画面"),
  width,
  height,
});

describe("selected node controls in screen space", () => {
  it("makes room for an oversized node without changing document geometry", () => {
    const selected = node(300, 100, 360, 900);
    const original = structuredClone(selected);
    const size = { width: 800, height: 700 };
    const view = studioNodeEditingView(selected, viewport, size);
    const p = studioNodePlacement(selected, view, size)!;
    expect(p.panelHeight).toBeGreaterThanOrEqual(300);
    expect(p.panelY).toBeGreaterThan(
      selected.position.y * view.k + view.y + selected.height * view.k,
    );
    expect(view.k).toBeLessThan(1);
    expect(selected).toEqual(original);
  });
  it("preserves the viewport when editing room is sufficient", () => {
    expect(studioNodeEditingView(node(240, 210), viewport, canvas)).toBe(
      viewport,
    );
  });
  it("keeps a downward composer above the persistent tool dock", () => {
    const placement = studioNodePlacement(node(240, 220), viewport, {
      width: 600,
      height: 560,
    })!;
    expect(placement.panelY + placement.panelHeight).toBeLessThanOrEqual(
      560 - 76,
    );
  });
  it.each([0.12, 0.5, 1, 3])(
    "keeps readable controls and a 12px gap at zoom %s",
    (k) => {
      const view = { x: -83, y: 47, k };
      // Each world rectangle occupies the same 240,210–500,360 screen rectangle.
      const selected = node(
        (240 - view.x) / k,
        (210 - view.y) / k,
        260 / k,
        150 / k,
      );
      const placement = studioNodePlacement(selected, view, canvas)!;
      expect(placement.x).toBeCloseTo(193);
      expect(placement.y).toBeCloseTo(154);
      expect(placement.width).toBe(354);
      expect(placement.y + 44 + 12).toBeCloseTo(210);
      expect(placement.panelBelow).toBe(true);
      expect(placement.panelY).toBe(372);
      expect(placement.panelWidth).toBe(680);
      expect(placement.panelHeight).toBeGreaterThanOrEqual(300);
    },
  );

  it("places the toolbar below a node touching the upper edge", () => {
    const placement = studioNodePlacement(
      node(300, 5, 260, 100),
      viewport,
      canvas,
    )!;
    expect(placement.y).toBe(117);
    expect(placement.panelBelow).toBe(true);
    expect(placement.panelHeight).toBeGreaterThanOrEqual(300);
  });

  it("opens the panel upward for nodes near the lower edge", () => {
    const placement = studioNodePlacement(
      node(300, 650, 260, 120),
      viewport,
      canvas,
    )!;
    expect(placement.y).toBe(594);
    expect(placement.panelBelow).toBe(false);
    expect(placement.panelHeight).toBeGreaterThanOrEqual(300);
    expect(placement.panelY).toBeGreaterThanOrEqual(12);
    expect(placement.panelY + placement.panelHeight + 12).toBe(placement.y);
  });

  it.each([
    { selected: node(-70, 200, 100, 100), expectedX: 12 },
    { selected: node(980, 200, 100, 100), expectedX: 634 },
  ])(
    "keeps the full toolbar on screen when its node is partially clipped horizontally",
    ({ selected, expectedX }) => {
      const placement = studioNodePlacement(selected, viewport, canvas)!;
      expect(placement.x).toBe(expectedX);
      expect(placement.x + placement.width).toBeLessThanOrEqual(
        canvas.width - 12,
      );
    },
  );

  it("narrows the toolbar to the available space on a compact canvas", () => {
    const placement = studioNodePlacement(node(100, 200), viewport, {
      width: 280,
      height: 800,
    })!;
    expect(placement).toMatchObject({ x: 12, width: 256 });
    expect(placement.x + placement.width).toBe(268);
  });

  it.each([
    node(-300, 200, 100, 100),
    node(1001, 200, 100, 100),
    node(300, -200, 100, 100),
    node(300, 801, 100, 100),
  ])(
    "hides all controls when the selected rectangle leaves the viewport",
    (selected) => {
      expect(studioNodePlacement(selected, viewport, canvas)).toBeNull();
    },
  );

  it("uses the transformed rectangle for visibility and preserves controls on partial vertical intersections", () => {
    const selected = node(20, 20, 100, 100);
    expect(
      studioNodePlacement(selected, { x: -500, y: 0, k: 2 }, canvas),
    ).toBeNull();
    const partial = studioNodePlacement(
      selected,
      { x: 0, y: -100, k: 2 },
      canvas,
    )!;
    expect(partial.y).toBe(152);
    expect(partial.panelBelow).toBe(true);
  });
});
