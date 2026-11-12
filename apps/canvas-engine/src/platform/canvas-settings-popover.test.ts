import { describe, expect, it } from "vitest";

import { settingsPopoverPosition } from "@/components/canvas/canvas-image-settings-popover";

describe("canvas settings popover position", () => {
  it("keeps a right-aligned panel inside a narrow viewport", () => {
    const style = settingsPopoverPosition(
      { left: 272, right: 312, top: 300, bottom: 332, width: 40 },
      "bottomRight",
      { width: 320, height: 640 },
    );

    expect(style.width).toBe(296);
    expect(style.left).toBe(12);
    expect(style.top).toBe(340);
    expect(style.maxHeight).toBe(288);
  });

  it("flips above a trigger when the preferred lower position lacks room", () => {
    const style = settingsPopoverPosition(
      { left: 440, right: 500, top: 500, bottom: 532, width: 60 },
      "bottomRight",
      { width: 600, height: 640 },
    );

    expect(style.left).toBe(144);
    expect(style.bottom).toBe(148);
    expect(style.top).toBeUndefined();
    expect(style.maxHeight).toBe(480);
  });

  it("honors explicit placement when overflow adjustment is disabled", () => {
    const style = settingsPopoverPosition(
      { left: 120, right: 180, top: 18, bottom: 50, width: 60 },
      "topLeft",
      { width: 480, height: 560 },
      false,
    );

    expect(style.top).toBe(58);
    expect(style.bottom).toBeUndefined();
    expect(style.maxHeight).toBe(490);
  });
});
