import { describe, expect, it } from "vitest";
import {
  studioPortPosition,
  studioViewBounds,
  studioWireInBounds,
  studioWirePath,
} from "@/atlas-engine/studio/studio-scene-geometry";
import { makeStudioNode } from "@/atlas-engine/studio/studio-document";

describe("studio wire visibility", () => {
  it("keeps a crossing wire when both nodes are beyond the viewport overscan", () => {
    const from = makeStudioNode("image", -1100, 226, "left");
    const to = makeStudioNode("image", 2000, 226, "right");
    const bounds = studioViewBounds(
      { x: 0, y: 0, k: 1 },
      { width: 1000, height: 700 },
    );
    expect(from.position.x + from.width).toBeLessThan(bounds.left);
    expect(to.position.x).toBeGreaterThan(bounds.right);
    expect(
      studioWireInBounds(
        studioPortPosition(from, "source"),
        studioPortPosition(to, "target"),
        bounds,
      ),
    ).toBe(true);
  });

  it("rejects wires wholly outside the view and includes a curve's control-point reach", () => {
    const bounds = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(
      studioWireInBounds({ x: 0, y: -200 }, { x: 500, y: -101 }, bounds),
    ).toBe(false);
    expect(
      studioWireInBounds({ x: 500, y: 50 }, { x: 600, y: 50 }, bounds),
    ).toBe(false);
    expect(studioWireInBounds({ x: -5, y: 50 }, { x: -5, y: 50 }, bounds)).toBe(
      true,
    );
  });

  it("uses world coordinates consistently after panning and zooming", () => {
    const bounds = studioViewBounds(
      { x: -500, y: 200, k: 0.5 },
      { width: 1000, height: 700 },
      0,
    );
    expect(bounds).toEqual({
      left: 1000,
      top: -400,
      right: 3000,
      bottom: 1000,
    });
    expect(
      studioWireInBounds({ x: -1000, y: 500 }, { x: 4000, y: 500 }, bounds),
    ).toBe(true);
    expect(
      studioWireInBounds({ x: -1000, y: 1200 }, { x: 4000, y: 1200 }, bounds),
    ).toBe(false);
  });

  it("never rejects a curve with a sampled point inside the view", () => {
    const bounds = { left: -100, top: -100, right: 100, bottom: 100 };
    let checked = 0;
    for (let i = 0; i < 240; i++) {
      const from = { x: Math.sin(i * 3) * 700, y: Math.cos(i * 5) * 300 };
      const to = { x: Math.cos(i * 7) * 700, y: Math.sin(i * 11) * 300 };
      // Sample the actual SVG path rather than duplicating the visibility calculation.
      const [x0, y0, x1, y1, x2, y2, x3, y3] = studioWirePath(from, to)
        .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
        .map(Number);
      for (let step = 0; step <= 20; step++) {
        const t = step / 20,
          s = 1 - t;
        const x =
          s ** 3 * x0 + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t ** 3 * x3;
        const y =
          s ** 3 * y0 + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t ** 3 * y3;
        if (
          x >= bounds.left &&
          x <= bounds.right &&
          y >= bounds.top &&
          y <= bounds.bottom
        ) {
          expect(studioWireInBounds(from, to, bounds)).toBe(true);
          checked++;
          break;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
