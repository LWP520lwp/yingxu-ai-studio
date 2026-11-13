import { describe, expect, it } from "vitest";

import {
  fromCanvasDocument,
  replaceAtlasCanvasDocument,
  toCanvasConnections,
  toCanvasNodes,
  toCanvasViewport,
} from "@/atlas-engine/adapter";
import {
  updateAtlasCanvasConnections,
  updateAtlasCanvasNodes,
  updateAtlasCanvasViewport,
  updateAtlasSelectedConnection,
  updateAtlasSelectedNodes,
} from "@/atlas-engine/host/use-atlas-document-state";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, x = 0): CanvasNodeData => ({
  id,
  type: CanvasNodeType.Image,
  title: id,
  position: { x, y: 20 },
  width: 120,
  height: 80,
  metadata: {
    prompt: `prompt-${id}`,
    images: [{
      id: `image-${id}`,
      content: `data:image/png;base64,${id}`,
      status: "success",
      naturalWidth: 120,
      naturalHeight: 80,
      bytes: 14,
      mimeType: "image/png",
    }],
    storyWorkflow: {
      schemaVersion: 1,
      segmentId: `segment-${id}`,
      role: "storyboard",
      shotsJson: "[]",
    },
  },
});

const connection = (id: string, fromNodeId: string, toNodeId: string) => ({
  id,
  fromNodeId,
  toNodeId,
});

function initialDocument() {
  return fromCanvasDocument(
    [node("a"), node("b", 300)],
    [connection("edge-ab", "a", "b")],
    { x: 4, y: -8, k: 1.25 },
  );
}

describe("Atlas document host adapters", () => {
  it("round-trips all canvas node metadata, connections, viewport, and selection", () => {
    const sourceNodes = [node("a"), node("b", 300)];
    const sourceEdges = [connection("edge-ab", "a", "b")];
    const document = fromCanvasDocument(
      sourceNodes,
      sourceEdges,
      { x: 4, y: -8, k: 1.25 },
      { nodeIds: ["b"], edgeId: "edge-ab" },
    );

    expect(toCanvasNodes(document)).toEqual(sourceNodes);
    expect(toCanvasConnections(document)).toEqual(sourceEdges);
    expect(toCanvasViewport(document.viewport)).toEqual({ x: 4, y: -8, k: 1.25 });
    expect(document.selection).toEqual({ nodeIds: ["b"], edgeId: "edge-ab" });
  });

  it("drops malformed, dangling, self, duplicate-id, and duplicate-pair legacy edges", () => {
    const document = fromCanvasDocument(
      [node("a"), node("b")],
      [
        connection("valid", "a", "b"),
        connection("dangling", "a", "missing"),
        connection("self", "a", "a"),
        connection("valid", "b", "a"),
        connection("reverse", "a", "b"),
      ],
      { x: 0, y: 0, k: 1 },
    );

    expect(toCanvasConnections(document)).toEqual([connection("valid", "a", "b")]);
  });

  it("applies functional node updates through Atlas and preserves revision monotonicity", () => {
    const initial = initialDocument();
    const initialProjections = toCanvasNodes(initial);
    const updated = updateAtlasCanvasNodes(initial, (nodes) =>
      nodes.map((item) => item.id === "a" ? { ...item, title: "renamed" } : item),
    );

    const projected = toCanvasNodes(updated);
    expect(projected[0]?.title).toBe("renamed");
    expect(projected[1]).toBe(initialProjections[1]);
    expect(updated.revision).toBeGreaterThan(initial.revision);
    expect(toCanvasConnections(updated)).toHaveLength(1);
  });

  it("reuses immutable projections across reads of the same Atlas records", () => {
    const initial = initialDocument();
    const firstNodes = toCanvasNodes(initial);
    const firstEdges = toCanvasConnections(initial);

    expect(toCanvasNodes(initial)[0]).toBe(firstNodes[0]);
    expect(toCanvasConnections(initial)[0]).toBe(firstEdges[0]);
  });

  it("reuses unchanged Atlas nodes when a legacy updater returns fresh wrappers", () => {
    const initial = initialDocument();
    const unchanged = initial.nodes[1];
    const updated = updateAtlasCanvasNodes(initial, (nodes) =>
      nodes.map((item) => ({ ...item })),
    );

    expect(updated.nodes[1]).toBe(unchanged);
    expect(updated.nodes[0]).toBe(initial.nodes[0]);
  });

  it("cleans connected edges and selection when a selected node is removed", () => {
    let document = replaceAtlasCanvasDocument(
      initialDocument(),
      [node("a"), node("b", 300)],
      [connection("edge-ab", "a", "b")],
      { x: 0, y: 0, k: 1 },
      { nodeIds: ["a", "b"], edgeId: "edge-ab" },
    );
    document = updateAtlasCanvasNodes(document, (nodes) => nodes.filter(({ id }) => id !== "a"));

    expect(toCanvasNodes(document).map(({ id }) => id)).toEqual(["b"]);
    expect(toCanvasConnections(document)).toEqual([]);
    expect(document.selection).toEqual({ nodeIds: ["b"] });
  });

  it("routes viewport and selection setters through reducer commands", () => {
    let document = initialDocument();
    document = updateAtlasSelectedNodes(document, new Set(["a"]));
    document = updateAtlasSelectedConnection(document, "edge-ab");
    document = updateAtlasCanvasViewport(document, (viewport) => ({
      ...viewport,
      x: 20,
      k: 99,
    }));

    expect(document.selection).toEqual({ nodeIds: ["a"], edgeId: "edge-ab" });
    expect(toCanvasViewport(document.viewport)).toEqual({ x: 20, y: -8, k: 4 });

    const withoutConnection = updateAtlasCanvasConnections(document, []);
    expect(withoutConnection.selection.edgeId).toBeUndefined();
  });

  it("returns the same document and revision for no-op updates", () => {
    const initial = initialDocument();
    expect(updateAtlasCanvasNodes(initial, (nodes) => nodes)).toBe(initial);
    expect(updateAtlasCanvasConnections(initial, (edges) => edges)).toBe(initial);
    expect(updateAtlasCanvasViewport(initial, (viewport) => viewport)).toBe(initial);
    expect(updateAtlasSelectedNodes(initial, (ids) => ids)).toBe(initial);
    expect(updateAtlasSelectedConnection(initial, (id) => id)).toBe(initial);
  });
});
