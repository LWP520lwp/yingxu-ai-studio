import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_ANGLE_PARAMS,
  formatAngleValue,
  normalizeImageAngleParams,
  previewTransform,
} from "@/components/canvas/canvas-node-angle-dialog";

describe("canvas image angle dialog model", () => {
  it("starts from the established camera defaults", () => {
    expect(DEFAULT_IMAGE_ANGLE_PARAMS).toEqual({
      horizontalAngle: 0,
      pitchAngle: 9,
      cameraDistance: 4.8,
      wideAngle: false,
    });
  });

  it("bounds values before they are displayed or submitted", () => {
    expect(
      normalizeImageAngleParams({
        horizontalAngle: 90,
        pitchAngle: Number.NaN,
        cameraDistance: 0,
        wideAngle: false,
      }),
    ).toEqual({
      horizontalAngle: 60,
      pitchAngle: 0,
      cameraDistance: 1,
      wideAngle: false,
    });
  });

  it("formats fractional values and produces a finite preview transform", () => {
    expect(formatAngleValue(4)).toBe("4");
    expect(formatAngleValue(4.8)).toBe("4.8");
    expect(
      previewTransform({
        horizontalAngle: Number.POSITIVE_INFINITY,
        pitchAngle: -90,
        cameraDistance: Number.NaN,
        wideAngle: true,
      }),
    ).toBe("rotateY(0deg) rotateX(-15.75deg) scale(0.965)");
  });
});
