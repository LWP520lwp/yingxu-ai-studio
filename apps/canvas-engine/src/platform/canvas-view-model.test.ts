import { describe, expect, it } from "vitest";

import {
  canvasViewBounds,
  connectedSourcesByTarget,
  countCanvasGroupChildren,
  createCanvasViewIndex,
  indexCanvasNodes,
  relatedCanvasElements,
  selectVisibleConnections,
  selectVisibleNodes,
} from "@/atlas-engine/surface/spatial-index";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from "@/types/canvas";

const node = (
  id: string,
  x: number,
  type: CanvasNodeData["type"] = CanvasNodeType.Text,
  groupId?: string,
): CanvasNodeData => ({
  id,
  type,
  title: id,
  position: { x, y: 0 },
  width: 100,
  height: 80,
  metadata: groupId ? { groupId } : undefined,
});
const edge = (
  id: string,
  fromNodeId: string,
  toNodeId: string,
): CanvasConnection => ({ id, fromNodeId, toNodeId });

describe("canvas view model", () => {
  it("calculates viewport bounds and keeps a focused offscreen node mounted", () => {
    const bounds = canvasViewBounds(
      { x: -100, y: -50, k: 2 },
      { width: 400, height: 200 },
      10,
    );
    expect(bounds).toEqual({ left: 40, top: 15, right: 260, bottom: 135 });
    const nodes = [
      node("visible", 50),
      node("focused", 900),
      node("outside", 1200),
    ];
    expect(
      selectVisibleNodes(nodes, bounds, "focused").map((item) => item.id),
    ).toEqual(["visible", "focused"]);
  });

  it("culls missing and offscreen connections using the rendered curve bounds", () => {
    const nodes = [node("left", 0), node("right", 300), node("near", 180)];
    const map = indexCanvasNodes(nodes);
    const edges = [
      edge("edge-visible", "left", "right"),
      edge("edge-near", "left", "near"),
      edge("edge-stale", "left", "missing"),
    ];
    expect(
      selectVisibleConnections(edges, map, {
        left: 150,
        top: -10,
        right: 250,
        bottom: 100,
      }).map(({ connection }) => connection.id),
    ).toEqual(["edge-visible", "edge-near"]);
  });

  it("indexes group members, connected inputs and related highlights", () => {
    const nodes = [
      node("group", 0, CanvasNodeType.Group),
      node("member", 120, CanvasNodeType.Text, "group"),
      node("image", 240, CanvasNodeType.Image),
      node("target", 360),
    ];
    const edges = [
      edge("a", "member", "target"),
      edge("b", "image", "target"),
      edge("c", "target", "member"),
    ];
    const map = indexCanvasNodes(nodes);
    expect(countCanvasGroupChildren(nodes).get("group")).toBe(1);
    expect(
      connectedSourcesByTarget(edges, map)
        .get("target")
        ?.map((item) => item.id),
    ).toEqual(["member", "image"]);
    const related = relatedCanvasElements("group", nodes, edges, map);
    expect([...related.nodeIds].sort()).toEqual(["group", "member"]);
    expect(related.connectionIds.size).toBe(0);
  });

  it("culls backwards edges by their actual curve bounds and sanitizes invalid viewport values", () => {
    const nodes = [node("left", 400), node("right", 0)];
    const map = indexCanvasNodes(nodes);
    const edge = { id: "backwards", fromNodeId: "left", toNodeId: "right" };
    expect(
      selectVisibleConnections([edge], map, {
        left: 180,
        top: 30,
        right: 220,
        bottom: 60,
      }),
    ).toHaveLength(1);
    expect(
      canvasViewBounds(
        { x: Number.NaN, y: 10, k: 0 },
        { width: 400, height: 200 },
        Number.NaN,
      ),
    ).toEqual({ left: 0, top: -200, right: 8000, bottom: 3800 });
  });

  it("follows nested groups and deduplicates repeated source nodes", () => {
    const nodes = [
      node("outer", 0, CanvasNodeType.Group),
      node("inner", 120, CanvasNodeType.Group, "outer"),
      node("child", 240, CanvasNodeType.Text, "inner"),
      node("target", 360),
    ];
    const edges = [
      edge("one", "child", "target"),
      edge("two", "child", "target"),
    ];
    const related = relatedCanvasElements(
      "outer",
      nodes,
      edges,
      indexCanvasNodes(nodes),
    );
    expect([...related.nodeIds].sort()).toEqual(["child", "inner", "outer"]);
    expect(
      connectedSourcesByTarget(edges, indexCanvasNodes(nodes)).get("target"),
    ).toEqual([nodes[2]]);
  });

  it("keeps indexed viewport results identical to a full scan, including focus retention", () => {
    const nodes = [node("first", 0), node("far", 2400), node("second", 180)];
    const edges = [
      edge("crossing", "first", "far"),
      edge("local", "first", "second"),
      edge("stale", "first", "missing"),
    ];
    const bounds = { left: 80, top: -20, right: 220, bottom: 100 };
    const nodeById = indexCanvasNodes(nodes);
    const index = createCanvasViewIndex(nodes, edges, nodeById);

    expect(selectVisibleNodes(nodes, bounds, "far", index)).toEqual(
      selectVisibleNodes(nodes, bounds, "far"),
    );
    expect(selectVisibleConnections(edges, nodeById, bounds, index)).toEqual(
      selectVisibleConnections(edges, nodeById, bounds),
    );
  });

  it("narrows nearby node candidates on a large board and falls back safely for huge viewports", () => {
    const nodes = Array.from({ length: 5000 }, (_, index) =>
      node(`node-${index}`, index * 500),
    );
    const index = createCanvasViewIndex(nodes, [], indexCanvasNodes(nodes));

    expect(
      index.nodes
        .query({ left: 0, top: 0, right: 400, bottom: 100 })
        .map((entry) => entry.value.id),
    ).toEqual(["node-0"]);
    expect(
      selectVisibleNodes(
        nodes,
        { left: 0, top: 0, right: 400, bottom: 100 },
        undefined,
        index,
      ).map((item) => item.id),
    ).toEqual(["node-0"]);
    expect(
      selectVisibleNodes(
        nodes,
        { left: -1, top: -1, right: 3_000_000, bottom: 200 },
        undefined,
        index,
      ),
    ).toHaveLength(5000);
  });

  it("handles coordinates beyond safe grid-cell integers without entering cell loops", () => {
    const far = node("far", 1e30);
    const index = createCanvasViewIndex([far], [], indexCanvasNodes([far]));
    expect(
      index.nodes.query({ left: 1e30, top: -1, right: 1e30, bottom: 100 }),
    ).toHaveLength(1);
  });
});
