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
  imageSizePresets,
  mediaRatioOptions,
  videoRatioOptions,
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

  it("keeps every image preset and its portrait transpose available to old drafts", () => {
    for (const [scale, presets] of Object.entries(imageSizePresets)) {
      expect(Object.keys(presets)).toHaveLength(mediaRatioOptions.length - 1);
      for (const [ratio, size] of Object.entries(presets)) {
        const [width, height] = ratio.split(":");
        const pixels = parsePixelSize(size)!;
        expect(presets[`${height}:${width}`]).toBe(
          `${pixels.height}x${pixels.width}`,
        );
        expect(inferMediaScale(size)).toBe(scale);
        expect(computeMediaSize(scale, ratio)).toBe(size);
      }
    }
    expect(videoRatioOptions.map(({ value }) => value)).toEqual([
      "1:1",
      "3:4",
      "4:3",
      "16:9",
      "9:16",
      "21:9",
      "auto",
    ]);
  });

  it("rejects unsafe integers and keeps both video axes codec-compatible for odd resolutions", () => {
    expect(parsePixelSize("9007199254740993x1080")).toBeNull();
    expect(parseVideoResolution("9".repeat(320))).toBe("720");
    expect(computeVideoSize("721", "16:9")).toBe("1284x722");
    expect(computeVideoSize("721", "9:16")).toBe("722x1284");
    expect(computeVideoSize("720", "0.00000000000000000001:1")).toBe("auto");
    expect(inferMediaRatio(" 16:9 ")).toBe("16:9");
  });
});
