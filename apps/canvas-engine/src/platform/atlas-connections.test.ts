import { describe, expect, it } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import {
  connectionAnchor,
  resolveConnection,
  resolveConnectionDrop,
} from "@/atlas-engine/interaction/connections";

function node(id: string, type: CanvasNodeType, x: number, y = 0): CanvasNodeData {
  return { id, type, title: id, position: { x, y }, width: 100, height: 80 };
}

describe("Atlas connection model", () => {
  it("places the ports on opposite horizontal edges", () => {
    const item = node("image", CanvasNodeType.Image, 20, 10);
    expect(connectionAnchor(item, "source")).toEqual({ x: 20, y: 50 });
    expect(connectionAnchor(item, "target")).toEqual({ x: 120, y: 50 });
  });

  it("normalizes config-node connections regardless of drag direction", () => {
    const image = node("image", CanvasNodeType.Image, 0);
    const config = node("config", CanvasNodeType.Config, 150);
    expect(resolveConnection("image", "config", [image, config], "source"))
      .toEqual({ fromNodeId: "image", toNodeId: "config" });
    expect(resolveConnection("config", "image", [config, image], "source"))
      .toEqual({ fromNodeId: "config", toNodeId: "image" });
    expect(resolveConnection("config", "image", [config, image], "target"))
      .toEqual({ fromNodeId: "image", toNodeId: "config" });
  });

  it("rejects missing, self, group-target, and config-config edges", () => {
    const image = node("image", CanvasNodeType.Image, 0);
    const group = node("group", CanvasNodeType.Group, 120);
    const configA = node("config-a", CanvasNodeType.Config, 240);
    const configB = node("config-b", CanvasNodeType.Config, 360);
    const nodes = [image, group, configA, configB];
    expect(resolveConnection("missing", "image", nodes, "source")).toBeNull();
    expect(resolveConnection("image", "image", nodes, "source")).toBeNull();
    expect(resolveConnection("image", "group", nodes, "source")).toBeNull();
    expect(resolveConnection("config-a", "config-b", nodes, "source")).toBeNull();
  });

  it("picks an eligible body hit and reports an invalid nearby target", () => {
    const source = node("source", CanvasNodeType.Image, 0);
    const group = node("group", CanvasNodeType.Group, 140);
    const target = node("target", CanvasNodeType.Text, 140);
    const nodes = [source, target, group];
    expect(resolveConnectionDrop({ x: 160, y: 20 }, 1, { nodeId: "source", handleType: "source" }, nodes))
      .toEqual({ nodeId: "target", isNearNode: true });
    expect(resolveConnectionDrop({ x: 40, y: 30 }, 1, { nodeId: "source", handleType: "source" }, [source]))
      .toEqual({ nodeId: null, isNearNode: true });
    expect(resolveConnectionDrop({ x: 900, y: 900 }, 1, { nodeId: "source", handleType: "source" }, nodes))
      .toEqual({ nodeId: null, isNearNode: false });
  });

  it("keeps the hit radius screen-sized as zoom changes and rejects invalid points", () => {
    const source = node("source", CanvasNodeType.Image, 0);
    const target = node("target", CanvasNodeType.Text, 200);
    const start = { nodeId: "source", handleType: "source" as const };
    expect(resolveConnectionDrop({ x: 198, y: 40 }, 2, start, [source, target]).nodeId).toBe("target");
    expect(resolveConnectionDrop({ x: Number.NaN, y: 40 }, 1, start, [source, target]))
      .toEqual({ nodeId: null, isNearNode: false });
  });
});
