import { describe, expect, it } from "vitest";

import {
  CANVAS_SIDE_PANEL_DEFAULT_WIDTH,
  CANVAS_SIDE_PANEL_MAX_WIDTH,
  CANVAS_SIDE_PANEL_MIN_WIDTH,
  clampCanvasSidePanelWidth,
  createCanvasSidePanelLifecycle,
  normalizeCanvasNodeViewMode,
  readCanvasSidePanelPreference,
  transitionCanvasSidePanel,
  writeCanvasSidePanelPreference,
} from "@/lib/canvas/canvas-side-panel-state";

describe("canvas side panel state", () => {
  it("keeps the panel mounted during close and lets reopen invalidate the close", () => {
    const initial = createCanvasSidePanelLifecycle(true);
    const closing = transitionCanvasSidePanel(initial, "close");

    expect(closing).toEqual({
      panelOpen: false,
      panelMounted: true,
      panelClosing: true,
    });
    expect(transitionCanvasSidePanel(closing, "close")).toBe(closing);

    const reopened = transitionCanvasSidePanel(closing, "open");
    expect(reopened).toEqual({
      panelOpen: true,
      panelMounted: true,
      panelClosing: false,
    });
    expect(transitionCanvasSidePanel(reopened, "finish-close")).toBe(reopened);
  });

  it("clamps invalid widths and normalizes unsupported view modes", () => {
    expect(clampCanvasSidePanelWidth(Number.NaN)).toBe(
      CANVAS_SIDE_PANEL_DEFAULT_WIDTH,
    );
    expect(clampCanvasSidePanelWidth(100)).toBe(CANVAS_SIDE_PANEL_MIN_WIDTH);
    expect(clampCanvasSidePanelWidth(800)).toBe(CANVAS_SIDE_PANEL_MAX_WIDTH);
    expect(normalizeCanvasNodeViewMode("grid")).toBe("grid");
    expect(normalizeCanvasNodeViewMode("tiles")).toBe("list");
  });

  it("treats unavailable browser storage as a non-fatal preference miss", () => {
    const blocked = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
    };

    expect(readCanvasSidePanelPreference(blocked, "panel")).toBeNull();
    expect(writeCanvasSidePanelPreference(blocked, "panel", "open")).toBe(
      false,
    );
    expect(readCanvasSidePanelPreference(null, "panel")).toBeNull();
    expect(writeCanvasSidePanelPreference(null, "panel", "open")).toBe(false);
  });
});
