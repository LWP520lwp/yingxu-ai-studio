import { describe, expect, it } from "vitest";

import {
  placeSelectionToolbar,
  selectionActionIds,
} from "@/components/canvas/canvas-selection-toolbar";

describe("canvas selection toolbar", () => {
  it("shows only enabled actions in their established order", () => {
    expect(
      selectionActionIds({ canMerge: true, canGroup: false, canUngroup: true }),
    ).toEqual(["merge", "ungroup"]);
    expect(
      selectionActionIds({ canMerge: false, canGroup: true, canUngroup: true }),
    ).toEqual(["group", "ungroup"]);
    expect(
      selectionActionIds({
        canMerge: false,
        canGroup: false,
        canUngroup: false,
      }),
    ).toEqual([]);
  });

  it("centers the action bar above a selection and keeps it inside the canvas", () => {
    expect(
      placeSelectionToolbar({
        selection: { left: 400, top: 220, width: 300 },
        toolbar: { width: 360, height: 48 },
        canvas: { width: 1200, height: 720 },
      }),
    ).toEqual({ left: 370, top: 164, width: 360, maxWidth: 1176 });
  });

  it("shrinks and clamps the action bar on a narrow, short canvas", () => {
    const placement = placeSelectionToolbar({
      selection: { left: -80, top: 330, width: 240 },
      toolbar: { width: 360, height: 48 },
      canvas: { width: 240, height: 220 },
    });
    expect(placement).toEqual({ left: 12, top: 76, width: 216, maxWidth: 216 });
    expect(placement.left + placement.width).toBeLessThanOrEqual(228);
  });
});
