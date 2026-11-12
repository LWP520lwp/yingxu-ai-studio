import { describe, expect, it } from "vitest";

import { themeRevealPaths, type ThemeRevealShape } from "@/lib/theme-transition";

describe("theme reveal geometry", () => {
  const shapes: ThemeRevealShape[] = [
    "circle",
    "square",
    "triangle",
    "diamond",
    "hexagon",
    "rectangle",
    "star",
  ];

  it("creates a collapsed and expanded path for every supported shape", () => {
    for (const shape of shapes) {
      const [start, end] = themeRevealPaths(shape, 37, 29, 120, 90);
      expect(start).not.toContain("NaN");
      expect(end).not.toContain("Infinity");
      expect(start).toMatch(/^(circle|polygon)\(/);
      expect(end).toMatch(/^(circle|polygon)\(/);
      expect(start).not.toBe(end);
    }
  });

  it("keeps output finite for zero-sized viewports and invalid origins", () => {
    const [start, end] = themeRevealPaths("hexagon", Number.NaN, 0, 0, 0);
    expect(start).toContain("0px 0px");
    expect(end).not.toMatch(/NaN|Infinity/);
  });

  it("places rectangular coverage around the requested reveal origin", () => {
    const [, end] = themeRevealPaths("rectangle", 25, 15, 100, 80);
    expect(end).toContain("-50px -50px");
    expect(end).toContain("100px 80px");
  });
});
