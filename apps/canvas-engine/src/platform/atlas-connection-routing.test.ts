import { describe, expect, it } from "vitest";
import { routeCanvasConnection, routeConnectionPreview } from "@/atlas-engine/surface/connection-routing";

describe("Atlas connection routing", () => {
  it("routes horizontally arranged nodes through facing side ports", () => {
    const route = routeCanvasConnection(
      { x: 0, y: 0, width: 100, height: 60 },
      { x: 300, y: 120, width: 100, height: 60 },
    );

    expect(route.startSide).toBe("right");
    expect(route.endSide).toBe("left");
    expect(route.start).toEqual({ x: 100, y: 30 });
    expect(route.end).toEqual({ x: 300, y: 150 });
    expect(route.path).toContain(`C ${route.control1.x} ${route.control1.y}, ${route.control2.x} ${route.control2.y}`);
  });

  it("uses top and bottom ports when vertical separation is dominant", () => {
    const route = routeCanvasConnection(
      { x: 0, y: 0, width: 100, height: 60 },
      { x: 30, y: 300, width: 100, height: 60 },
    );

    expect(route.startSide).toBe("bottom");
    expect(route.endSide).toBe("top");
    expect(route.start).toEqual({ x: 50, y: 60 });
    expect(route.end).toEqual({ x: 80, y: 300 });
  });

  it("keeps previews attached to the selected input or output handle", () => {
    const node = { x: 0, y: 0, width: 100, height: 60 };
    const output = routeConnectionPreview(node, "source", { x: 220, y: -50 });
    const input = routeConnectionPreview(node, "target", { x: -120, y: 100 });

    expect(output.startSide).toBe("right");
    expect(output.start).toEqual({ x: 100, y: 30 });
    expect(input.endSide).toBe("left");
    expect(input.end).toEqual({ x: 0, y: 30 });
  });
});
