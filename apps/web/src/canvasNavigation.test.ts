import { describe, expect, it } from "vitest";
import { parseCanvasPlatformAction } from "./CanvasEngine";

describe("canvas host destinations", () => {
  it("accepts the independent home destination and existing host panels", () => {
    for (const action of ["home", "projects", "newProject", "skills", "skillImport", "workflow", "pool", "settings"]) {
      expect(parseCanvasPlatformAction(action)).toBe(action);
    }
  });

  it("rejects arbitrary external routes and unknown actions instead of opening settings", () => {
    for (const action of ["https://docs.canvas.best", "/", "unexpected", null, undefined, {}]) {
      expect(() => parseCanvasPlatformAction(action)).toThrow("尚未接入");
    }
  });
});
