import { describe, expect, it } from "vitest";

import {
  clampTextGenerationCount,
  normalizeReasoningEffort,
  placeTextSettingsPopover,
} from "@/lib/canvas/text-generation-settings";

describe("text generation settings", () => {
  it("normalizes unsupported reasoning effort without losing known values", () => {
    expect(normalizeReasoningEffort("high")).toBe("high");
    expect(normalizeReasoningEffort("unknown")).toBe("auto");
    expect(normalizeReasoningEffort(undefined)).toBe("auto");
  });

  it("clamps generated text count to whole numbers between one and fifteen", () => {
    expect(clampTextGenerationCount(2.7)).toBe(3);
    expect(clampTextGenerationCount(0)).toBe(1);
    expect(clampTextGenerationCount(60)).toBe(15);
    expect(clampTextGenerationCount(Number.NaN)).toBe(1);
  });

  it("fits to narrow viewports and flips above the trigger when needed", () => {
    const narrow = placeTextSettingsPopover(
      { left: 280, right: 320, top: 300, bottom: 340, width: 40, height: 40 },
      { width: 320, height: 700 },
      "bottomRight",
    );
    expect(narrow.width).toBe(296);
    expect(narrow.left).toBe(12);
    expect(narrow.top).toBeGreaterThanOrEqual(348);

    const top = placeTextSettingsPopover(
      { left: 700, right: 740, top: 280, bottom: 320, width: 40, height: 40 },
      { width: 1200, height: 360 },
      "topLeft",
    );
    expect(top.top + top.maxHeight).toBeLessThanOrEqual(272);
    expect(top.left).toBeGreaterThanOrEqual(12);
  });
});
