import { describe, expect, it } from "vitest";
import { applyAtlasCommands, reduceAtlasDocument } from "@/atlas-engine/reducer";
import { createAtlasDocument, type AtlasNode } from "@/atlas-engine/model";

const node = (id: string, x = 0): AtlasNode => ({
  id, kind: "image", title: id, frame: { x, y: 20, width: 120, height: 80 }, data: { source: "atlas" },
});

describe("Atlas document reducer", () => {
  it("moves, connects, and selects with immutable revisions", () => {
    const initial = createAtlasDocument({ nodes: [node("a"), node("b", 300)] });
    const moved = reduceAtlasDocument(initial, { type: "move-nodes", ids: ["a"], delta: { x: 20, y: -5 } });
    expect(moved).not.toBe(initial);
    expect(moved.nodes[0].frame).toEqual({ x: 20, y: 15, width: 120, height: 80 });
    const connected = reduceAtlasDocument(moved, { type: "connect", edge: { id: "edge-1", source: "a", target: "b" } });
    const selected = reduceAtlasDocument(connected, { type: "select", nodeIds: ["a", "missing"], edgeId: "edge-1" });
    expect(selected.edges).toHaveLength(1);
    expect(selected.selection).toEqual({ nodeIds: ["a"], edgeId: "edge-1" });
    expect(selected.revision).toBe(3);
  });

  it("rejects invalid and duplicate edges and cleans selection on deletion", () => {
    const initial = createAtlasDocument({ nodes: [node("a"), node("b")] });
    const invalid = reduceAtlasDocument(initial, { type: "connect", edge: { id: "bad", source: "a", target: "missing" } });
    expect(invalid).toBe(initial);
    const connected = reduceAtlasDocument(initial, { type: "connect", edge: { id: "edge", source: "a", target: "b" } });
    expect(reduceAtlasDocument(connected, { type: "connect", edge: { id: "other", source: "a", target: "b" } })).toBe(connected);
    const selected = reduceAtlasDocument(connected, { type: "select", nodeIds: ["a"], edgeId: "edge" });
    const deleted = reduceAtlasDocument(selected, { type: "remove-nodes", ids: ["a"] });
    expect(deleted.nodes.map(({ id }) => id)).toEqual(["b"]);
    expect(deleted.edges).toEqual([]);
    expect(deleted.selection).toEqual({ nodeIds: [] });
  });

  it("clamps viewport and applies command batches deterministically", () => {
    const result = applyAtlasCommands(createAtlasDocument(), [
      { type: "upsert-node", node: node("a") },
      { type: "set-viewport", viewport: { x: 5, y: 10, zoom: 99 } },
      { type: "clear-selection" },
    ]);
    expect(result.viewport).toEqual({ x: 5, y: 10, zoom: 4 });
    expect(result.nodes).toHaveLength(1);
  });
});
