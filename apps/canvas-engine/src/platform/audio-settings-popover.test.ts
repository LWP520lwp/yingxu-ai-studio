import { describe, expect, it } from "vitest";

import { positionAudioSettingsPopover } from "@/atlas-engine/ui/audio-settings-popover";

describe("audio settings popover placement", () => {
  it("aligns to the requested side and clamps horizontally", () => {
    expect(
      positionAudioSettingsPopover(
        { left: 900, right: 980, top: 500, bottom: 540, width: 80 },
        { width: 1024, height: 768 },
        "topRight",
      ),
    ).toEqual({ width: 356, left: 624, bottom: 276, maxHeight: 480 });
  });

  it("fits the panel to narrow viewports", () => {
    const position = positionAudioSettingsPopover(
      { left: 3, right: 43, top: 100, bottom: 140, width: 40 },
      { width: 320, height: 568 },
      "bottomLeft",
    );
    expect(position.width).toBe(296);
    expect(position.left).toBe(12);
    expect(position.left + position.width).toBeLessThanOrEqual(308);
  });

  it("flips when the requested side has less useful space", () => {
    const position = positionAudioSettingsPopover(
      { left: 30, right: 110, top: 32, bottom: 72, width: 80 },
      { width: 480, height: 720 },
      "topLeft",
    );
    expect(position.top).toBe(80);
    expect(position.bottom).toBeUndefined();
    expect(position.maxHeight).toBe(628);
  });

  it("keeps finite bounds for degenerate viewport and coordinates", () => {
    const position = positionAudioSettingsPopover(
      { left: Number.NaN, right: 10, top: -100, bottom: 0, width: 10 },
      { width: 0, height: 0 },
      "top",
    );
    expect(position.width).toBe(1);
    expect(position.left).toBe(0);
    expect(position.maxHeight).toBeGreaterThan(0);
    expect(Number.isFinite(position.left)).toBe(true);
    expect((position.top ?? 0) + (position.maxHeight || 0)).toBeLessThanOrEqual(
      1,
    );
  });
});
