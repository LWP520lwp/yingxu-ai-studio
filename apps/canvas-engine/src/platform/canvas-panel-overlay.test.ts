import { describe, expect, it } from "vitest";

import {
  canvasPanelOverlayStyle,
  measureCanvasPanelOverlay,
  sameCanvasPanelPlacement,
} from "@/atlas-engine/ui/panel-overlay";

const viewport = { left: 200, top: 80, right: 1100, bottom: 800 };

describe("canvas panel overlay geometry", () => {
  it("converts fitted screen coordinates back into the scaled node layer", () => {
    const placement = measureCanvasPanelOverlay({
      node: { left: 800, right: 1000, top: 520, bottom: 620 },
      viewport,
      panelWidth: 560,
      panelHeight: 260,
      scale: 0.5,
      bottomInset: 90,
    });

    expect(placement.left).toBeGreaterThanOrEqual(viewport.left + 12);
    expect(placement.left + placement.width).toBeLessThanOrEqual(
      viewport.right - 12,
    );
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(
      viewport.bottom - 90 - 12,
    );
    expect(placement.localLeft).toBe((placement.left - 800) / 0.5);
    expect(placement.localTop).toBe((placement.top - 520) / 0.5);
  });

  it("uses a stable identity placement for equivalent measurements", () => {
    const first = measureCanvasPanelOverlay({
      node: { left: 450, right: 650, top: 100, bottom: 200 },
      viewport: { left: 0, top: 0, right: 1200, bottom: 720 },
      panelWidth: 600,
      panelHeight: 200,
      scale: 1,
    });
    const equivalent = { ...first };

    expect(sameCanvasPanelPlacement(first, equivalent)).toBe(true);
    expect(
      sameCanvasPanelPlacement(first, { ...first, top: first.top + 1 }),
    ).toBe(false);
    expect(sameCanvasPanelPlacement(null, first)).toBe(false);
  });

  it("renders a centered counter-scaled fallback before measuring", () => {
    expect(canvasPanelOverlayStyle(null, 0.5, 560)).toEqual({
      left: "50%",
      top: "100%",
      width: 560,
      maxHeight: undefined,
      transform: "translateX(-50%) scale(2)",
      transformOrigin: "top center",
    });
  });

  it("keeps invalid scale values from producing infinite CSS transforms", () => {
    expect(canvasPanelOverlayStyle(null, 0, 560).transform).toBe(
      "translateX(-50%) scale(1)",
    );
    expect(
      measureCanvasPanelOverlay({
        node: { left: 0, right: 100, top: 0, bottom: 100 },
        viewport: { left: 0, top: 0, right: 400, bottom: 400 },
        panelWidth: 200,
        panelHeight: 100,
        scale: Number.NaN,
      }).localLeft,
    ).toBe(12);
  });
});
