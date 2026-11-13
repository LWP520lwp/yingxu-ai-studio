import { describe, expect, it } from "vitest";
import { angleCameraPosition, DEFAULT_IMAGE_ANGLE_PARAMS, normalizeImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";

describe("independent requested camera model", () => {
  it("starts from a level camera at medium distance", () => {
    expect(DEFAULT_IMAGE_ANGLE_PARAMS).toEqual({ horizontalAngle: 0, pitchAngle: 0, cameraDistance: 5, wideAngle: false });
  });
  it("bounds requested camera inputs and recovers invalid values", () => {
    expect(normalizeImageAngleParams({ horizontalAngle: 90, pitchAngle: NaN, cameraDistance: 0, wideAngle: false }))
      .toEqual({ horizontalAngle: 60, pitchAngle: 0, cameraDistance: 1, wideAngle: false });
    expect(normalizeImageAngleParams({ horizontalAngle: -90, pitchAngle: 80, cameraDistance: Infinity, wideAngle: true }))
      .toEqual({ horizontalAngle: -60, pitchAngle: 45, cameraDistance: 5, wideAngle: true });
  });
  it("shows opposite camera locations for opposite yaw without transforming the reference image", () => {
    const left = angleCameraPosition({ ...DEFAULT_IMAGE_ANGLE_PARAMS, horizontalAngle: -45 });
    const right = angleCameraPosition({ ...DEFAULT_IMAGE_ANGLE_PARAMS, horizontalAngle: 45 });
    expect(left.x + right.x).toBeCloseTo(220); expect(left.y).toBeCloseTo(right.y);
    expect(left.x).toBeLessThan(110); expect(right.x).toBeGreaterThan(110);
  });
});
