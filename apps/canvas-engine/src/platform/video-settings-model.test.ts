import { describe, expect, it } from "vitest";

import {
  normalizeVideoMode,
  normalizeVideoOutputChoice,
  normalizeVideoResolution,
  normalizeVideoSize,
  normalizedVideoSeconds,
  sizeFromDimensions,
  videoDimensions,
  videoRatioForSize,
} from "@/lib/video-settings-model";

describe("video settings model", () => {
  it("normalizes legacy and invalid values to safe defaults", () => {
    expect(normalizeVideoMode("reference")).toBe("reference");
    expect(normalizeVideoMode("unknown")).toBe("frames");
    expect(normalizeVideoOutputChoice("true")).toBe("true");
    expect(normalizeVideoOutputChoice("yes")).toBe("auto");
    expect(normalizeVideoResolution("1080p")).toBe("1080");
    expect(normalizeVideoResolution("999999")).toBe("2304");
    expect(normalizeVideoResolution("999999", "9:21")).toBe("1754");
    expect(normalizedVideoSeconds("999")).toBe(30);
    expect(normalizedVideoSeconds("NaN")).toBe(6);
  });

  it("preserves valid explicit dimensions and repairs invalid sizes", () => {
    expect(normalizeVideoSize(" 1920 x 1080 ")).toBe("1920x1080");
    expect(normalizeVideoSize("0x1080")).toBe("auto");
    expect(normalizeVideoSize("5000x100")).toBe("auto");
    expect(normalizeVideoSize("9:16", "1080")).toBe("1080x1920");
    expect(videoRatioForSize("1920x1080")).toBe("16:9");
  });

  it("keeps custom dimensions positive and bounded", () => {
    expect(videoDimensions("auto", "1080p", "9:16")).toEqual({ width: 1080, height: 1920 });
    expect(sizeFromDimensions("width", 0, { width: 800, height: 450 })).toBe("800x450");
    expect(sizeFromDimensions("height", 50_000, { width: 800, height: 450 })).toBe("800x4096");
  });
});
