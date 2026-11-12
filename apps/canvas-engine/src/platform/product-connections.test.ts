import { describe, expect, it } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import {
  connectionTargetAnchor,
  findConnectionDropTarget,
  normalizeProductConnection,
} from "@/product-engine/connections";

const node = (
  id: string,
  x: number,
  y: number,
  patch: Partial<CanvasNodeData> = {},
): CanvasNodeData => ({
  id,
  type: CanvasNodeType.Text,
  title: id,
  position: { x, y },
  width: 100,
  height: 60,
  ...patch,
});

describe("product connection rules", () => {
  it("routes config connections into config nodes while preserving ordinary edge direction", () => {
    const source = node("source", 0, 0);
    const target = node("target", 150, 0);
    const config = node("config", 300, 0, { type: CanvasNodeType.Config });
    const group = node("group", 0, 0, { type: CanvasNodeType.Group });
    const nodes = [source, target, config, group];

    expect(normalizeProductConnection("source", "config", nodes, "source")).toEqual({ fromNodeId: "source", toNodeId: "config" });
    expect(normalizeProductConnection("config", "target", nodes, "target")).toEqual({ fromNodeId: "target", toNodeId: "config" });
    expect(normalizeProductConnection("config", "target", nodes, "source")).toEqual({ fromNodeId: "config", toNodeId: "target" });
    expect(normalizeProductConnection("config", "config", nodes, "target")).toBeNull();
    expect(normalizeProductConnection("target", "group", nodes, "source")).toBeNull();
    expect(normalizeProductConnection("source", "source", nodes, "source")).toBeNull();
    expect(normalizeProductConnection("missing", "source", nodes, "source")).toBeNull();
    expect(normalizeProductConnection("source", "target", nodes, "source")).toEqual({ fromNodeId: "source", toNodeId: "target" });
    expect(normalizeProductConnection("target", "source", nodes, "source")).toEqual({ fromNodeId: "target", toNodeId: "source" });
  });

  it("anchors the candidate node opposite the initiating handle", () => {
    const item = node("item", 20, 10, { width: 120, height: 80 });
    expect(connectionTargetAnchor(item, { nodeId: "other", handleType: "source" })).toEqual({ x: 20, y: 50 });
    expect(connectionTargetAnchor(item, { nodeId: "other", handleType: "target" })).toEqual({ x: 140, y: 50 });
  });

  it("prefers a node body over its handle and expanded hit area", () => {
    const source = node("source", 0, 0);
    const target = node("target", 150, 0);
    expect(findConnectionDropTarget({ x: 160, y: 10 }, 1, { nodeId: source.id, handleType: "source" }, [source, target])).toEqual({ nodeId: "target", isNearNode: true });
  });

  it("uses visual stacking order for equal-priority overlapping targets", () => {
    const source = node("source", -200, 0);
    const lower = node("lower", 0, 0);
    const upper = node("upper", 0, 0);
    expect(findConnectionDropTarget({ x: 20, y: 20 }, 1, { nodeId: source.id, handleType: "source" }, [source, lower, upper]).nodeId).toBe("upper");
  });

  it("keeps the hit region stable in screen space as the canvas zoom changes", () => {
    const source = node("source", 0, 0);
    const target = node("target", 200, 0);
    const start = { nodeId: source.id, handleType: "source" as const };
    expect(findConnectionDropTarget({ x: 175, y: 30 }, 1, start, [source, target])).toMatchObject({ nodeId: "target", isNearNode: true });
    expect(findConnectionDropTarget({ x: 175, y: 30 }, 2, start, [source, target])).toMatchObject({ nodeId: null, isNearNode: false });
  });

  it("distinguishes an invalid nearby drop from empty canvas", () => {
    const group = node("group", 100, 0, { type: CanvasNodeType.Group });
    const start = { nodeId: "source", handleType: "source" as const };
    expect(findConnectionDropTarget({ x: 110, y: 10 }, 1, start, [group])).toEqual({ nodeId: null, isNearNode: true });
    expect(findConnectionDropTarget({ x: 500, y: 500 }, 1, start, [group])).toEqual({ nodeId: null, isNearNode: false });
  });

  it("uses the most specific eligible target before topmost expanded candidates", () => {
    const source = node("source", -200, 0);
    const expanded = node("expanded", 0, 0);
    const interior = node("interior", 80, 0, { width: 20 });
    expect(findConnectionDropTarget({ x: 112, y: 20 }, 1, { nodeId: source.id, handleType: "source" }, [source, interior, expanded]).nodeId).toBe("interior");
  });

  it("returns a harmless empty target for invalid pointer coordinates", () => {
    expect(findConnectionDropTarget({ x: Number.NaN, y: 10 }, 1, { nodeId: "source", handleType: "source" }, [])).toEqual({ nodeId: null, isNearNode: false });
  });
});
