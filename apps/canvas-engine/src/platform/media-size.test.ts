import { describe, expect, it } from "vitest";

import {
  clampVideoSeconds,
  computeMediaSize,
  computeVideoSize,
  inferMediaRatio,
  inferMediaScale,
  inferVideoRatio,
  normalizeMediaScale,
  parseAspectRatio,
  parsePixelSize,
  parseVideoResolution,
  readMediaDimensions,
  readVideoDimensions,
} from "@/lib/media-size";

describe("media dimensions", () => {
  it("parses positive pixel sizes and ratios with whitespace", () => {
    expect(parsePixelSize(" 1920 x 1080 ")).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(parseAspectRatio(" 16 : 9 ")).toEqual({ width: 16, height: 9 });
    expect(parsePixelSize("0x1080")).toBeNull();
    expect(parsePixelSize("1e5x20")).toBeNull();
    expect(parseAspectRatio("16:0")).toBeNull();
  });

  it("retains image preset, scale, and nearest-ratio behavior", () => {
    expect(normalizeMediaScale(" 2048 ")).toBe("2k");
    expect(inferMediaScale("2048x1152")).toBe("2k");
    expect(inferMediaScale("3000x2000")).toBe("2k");
    expect(inferMediaScale("4000x2000")).toBe("4k");
    expect(inferMediaRatio("1920x1080")).toBe("16:9");
    expect(inferMediaRatio("garbage", "3:2")).toBe("3:2");
    expect(computeMediaSize("4k", "16:9")).toBe("3840x2160");
    expect(computeMediaSize("auto", "3:2")).toBe("3:2");
    expect(readMediaDimensions("auto", "2k", "4:3")).toEqual({
      width: 2048,
      height: 1536,
    });
  });

  it("keeps video sizes even and normalizes invalid resolution and duration", () => {
    expect(parseVideoResolution("1080p")).toBe("1080");
    expect(parseVideoResolution("high")).toBe("720");
    expect(parseVideoResolution("0p")).toBe("720");
    expect(inferVideoRatio("720x1280")).toBe("9:16");
    expect(computeVideoSize("720", "9:16")).toBe("720x1280");
    expect(computeVideoSize("720", "16:9")).toBe("1280x720");
    expect(computeVideoSize("720", "invalid")).toBe("auto");
    expect(readVideoDimensions("auto", "720", "auto")).toEqual({
      width: 1280,
      height: 720,
    });
    expect(clampVideoSeconds("3.9")).toBe("4");
    expect(clampVideoSeconds("99")).toBe("30");
    expect(clampVideoSeconds("bad")).toBe("6");
  });
});
