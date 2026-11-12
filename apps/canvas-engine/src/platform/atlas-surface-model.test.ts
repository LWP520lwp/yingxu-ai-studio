import { describe, expect, it } from "vitest";
import { createAtlasDocument, createAtlasSelection, reduceAtlasDocument, reduceAtlasSelection } from "@/atlas-engine/surface/model";

describe("atlas surface model", () => {
  it("supports additive selection and edge selection", () => {
    let selection = createAtlasSelection();
    selection = reduceAtlasSelection(selection, { type: "select-node", nodeId: "a" });
    selection = reduceAtlasSelection(selection, { type: "select-node", nodeId: "b", additive: true });
    expect(selection.nodeIds).toEqual(["a", "b"]);
    expect(reduceAtlasSelection(selection, { type: "select-edge", edgeId: "e" })).toEqual({ nodeIds: [], edgeId: "e" });
  });

  it("moves nodes, changes viewport, and rejects self-links", () => {
    const document = createAtlasDocument([{ id: "a", kind: "text", title: "A", position: { x: 0, y: 0 }, width: 100, height: 80 }]);
    const moved = reduceAtlasDocument(document, { type: "move-node", nodeId: "a", position: { x: 40, y: 50 } });
    expect(moved.nodes[0].position).toEqual({ x: 40, y: 50 });
    const viewport = reduceAtlasDocument(moved, { type: "set-viewport", viewport: { x: 10, y: 20, scale: 1.2 } });
    expect(viewport.viewport).toEqual({ x: 10, y: 20, scale: 1.2 });
    expect(reduceAtlasDocument(viewport, { type: "connect", edge: { id: "self", from: "a", to: "a" } }).edges).toEqual([]);
  });

  it("deduplicates edge IDs and removes an edge by command", () => {
    const base = createAtlasDocument([
      { id: "a", kind: "text", title: "A", position: { x: 0, y: 0 }, width: 100, height: 80 },
      { id: "b", kind: "image", title: "B", position: { x: 200, y: 0 }, width: 100, height: 80 },
    ]);
    const edge = { id: "e", from: "a", to: "b" };
    const added = reduceAtlasDocument(base, { type: "connect", edge });
    expect(reduceAtlasDocument(added, { type: "connect", edge }).edges).toHaveLength(1);
    expect(reduceAtlasDocument(added, { type: "disconnect", edgeId: "e" }).edges).toEqual([]);
  });
});
