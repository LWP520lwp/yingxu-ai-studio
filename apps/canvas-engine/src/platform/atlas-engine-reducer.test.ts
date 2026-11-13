import { describe, expect, it } from "vitest";
import { applyAtlasCommands, reduceAtlasDocument } from "@/atlas-engine/reducer";
import { createAtlasDocument, type AtlasNode } from "@/atlas-engine/model";
import { toCanvasNodes } from "@/atlas-engine/adapter";

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

  it("does not advance revisions for commands that make no document change", () => {
    const initial = createAtlasDocument({ nodes: [node("a")] });
    expect(reduceAtlasDocument(initial, { type: "move-nodes", ids: ["missing"], delta: { x: 4, y: 2 } })).toBe(initial);
    expect(reduceAtlasDocument(initial, { type: "move-nodes", ids: ["a"], delta: { x: 0, y: 0 } })).toBe(initial);
    expect(reduceAtlasDocument(initial, { type: "set-viewport", viewport: { x: 0, y: 0, zoom: 1 } })).toBe(initial);
    expect(reduceAtlasDocument(initial, { type: "patch-node", id: "a", patch: { title: "a" } })).toBe(initial);
    expect(reduceAtlasDocument(initial, { type: "upsert-node", node: node("a") })).toBe(initial);
  });

  it("rejects malformed and identity-changing commands without mutating the input", () => {
    const original = node("a");
    const initial = createAtlasDocument({ nodes: [original, node("b", 300)] });
    const before = JSON.stringify(initial);

    expect(reduceAtlasDocument(initial, {
      type: "patch-node",
      id: "a",
      patch: { id: "renamed" },
    })).toBe(initial);
    expect(reduceAtlasDocument(initial, {
      type: "move-nodes",
      ids: ["a"],
      delta: { x: Number.POSITIVE_INFINITY, y: 2 },
    })).toBe(initial);
    expect(JSON.stringify(initial)).toBe(before);
    expect(initial.nodes[0]).not.toBe(original);
    expect(initial.nodes[0].frame).not.toBe(original.frame);
    expect(initial.nodes[0].data).not.toBe(original.data);
  });

  it("rolls back the complete batch if a later command is invalid", () => {
    const initial = createAtlasDocument({ nodes: [node("a"), node("b", 300)] });
    const result = applyAtlasCommands(initial, [
      { type: "move-nodes", ids: ["a"], delta: { x: 10, y: 0 } },
      { type: "connect", edge: { id: "orphan", source: "a", target: "missing" } },
    ]);

    expect(result).toBe(initial);
    expect(result.nodes[0].frame.x).toBe(0);
    expect(result.revision).toBe(0);
  });

  it("rejects invalid source documents instead of retaining dangling edges", () => {
    expect(() => createAtlasDocument({
      nodes: [node("a")],
      edges: [{ id: "orphan", source: "a", target: "missing" }],
    })).toThrow("不存在的节点");
    expect(() => createAtlasDocument({ nodes: [node("a"), node("a")] })).toThrow("重复");
  });

  it("isolates nested metadata across source and compatibility projections", () => {
    const nested = [{ label: "before" }];
    const source = node("a");
    const document = createAtlasDocument({
      nodes: [{ ...source, data: { nested } }],
    });

    nested[0]!.label = "changed at source";
    const projected = toCanvasNodes(document);
    ((projected[0]!.metadata as unknown as Record<string, unknown>).nested as Array<{ label: string }>)[0]!.label =
      "changed at projection";

    expect((document.nodes[0]!.data!.nested as Array<{ label: string }>)[0]!.label)
      .toBe("before");
  });
});
