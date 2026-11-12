import { describe, expect, it } from "vitest";
import { createAtlasDocument, type AtlasNode } from "@/atlas-engine/model";
import { connectionPolyline, hitTestConnection, hitTestNode, screenPoint, worldPoint } from "@/atlas-engine/hit-testing";

const node = (id: string, x: number, y = 0): AtlasNode => ({ id, kind: "text", title: id, frame: { x, y, width: 100, height: 60 } });

describe("Atlas hit testing", () => {
  it("selects the topmost node and converts screen/world coordinates", () => {
    const nodes = [node("back", 0), node("front", 20)];
    expect(hitTestNode(nodes, { x: 30, y: 20 })?.id).toBe("front");
    const viewport = { x: 100, y: 50, zoom: 2 } as const;
    expect(worldPoint({ x: 140, y: 90 }, viewport)).toEqual({ x: 20, y: 20 });
    expect(screenPoint({ x: 20, y: 20 }, viewport)).toEqual({ x: 140, y: 90 });
  });

  it("hits a connection near its routed path and ignores distant points", () => {
    const nodes = [node("source", 0), node("target", 300, 100)];
    const document = createAtlasDocument({ nodes, edges: [{ id: "edge", source: "source", target: "target" }] });
    const path = connectionPolyline(nodes[0], nodes[1]);
    expect(hitTestConnection(document, path[1], 2)?.id).toBe("edge");
    expect(hitTestConnection(document, { x: 150, y: 400 }, 8)).toBeNull();
  });
});
