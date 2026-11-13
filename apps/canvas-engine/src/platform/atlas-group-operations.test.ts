import { describe, expect, it } from "vitest";

import {
  atlasGroupFrame,
  atlasNodeBounds,
  canAtlasGroupSelection,
  canAtlasUngroupSelection,
  collectAtlasGroupMembers,
  fitAtlasViewportForNode,
  type AtlasGeometryNode,
} from "@/atlas-engine/interaction/group-model";
import {
  applyAtlasGroupSelection,
  applyAtlasUngroupSelection,
} from "@/atlas-engine/interaction/canvas-group-adapter";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from "@/types/canvas";

const atlasNode = (
  id: string,
  x: number,
  y: number,
  patch: Partial<AtlasGeometryNode> = {},
): AtlasGeometryNode => ({
  id,
  kind: "node",
  position: { x, y },
  width: 100,
  height: 60,
  ...patch,
});

const canvasNode = (
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

const connection = (
  fromNodeId: string,
  toNodeId: string,
): CanvasConnection => ({
  id: `${fromNodeId}->${toNodeId}`,
  fromNodeId,
  toNodeId,
});

describe("Atlas group operations", () => {
  it("keeps bounds and wrapping finite for empty and malformed node frames", () => {
    expect(atlasNodeBounds([])).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
    expect(atlasGroupFrame([])).toEqual({
      x: -24,
      y: -52,
      width: 48,
      height: 76,
    });
    expect(
      atlasNodeBounds([
        atlasNode("invalid", Number.NaN, 20, {
          width: Number.POSITIVE_INFINITY,
          height: -5,
        }),
      ]),
    ).toEqual({ left: 0, top: 20, right: 0, bottom: 20 });
    expect(
      atlasNodeBounds([
        atlasNode("extreme", 1e308, -1e308, { width: 1e308, height: 1e308 }),
      ]),
    ).toEqual({ left: 1e12, top: -1e12, right: 2e12, bottom: 0 });
  });

  it("frames mixed-size members without changing their positions", () => {
    const members = [
      atlasNode("a", -10, 30),
      atlasNode("b", 150, -40, { width: 90, height: 80 }),
    ];
    expect(atlasGroupFrame(members)).toEqual({
      x: -34,
      y: -92,
      width: 298,
      height: 206,
    });
    expect(members[0].position).toEqual({ x: -10, y: 30 });
  });

  it("expands selected frames to direct content members and checks eligibility", () => {
    const frame = atlasNode("frame", 0, 0, {
      kind: "group",
      width: 300,
      height: 200,
    });
    const direct = atlasNode("direct", 10, 10, { groupId: frame.id });
    const nestedFrame = atlasNode("nested-frame", 20, 20, {
      kind: "group",
      groupId: frame.id,
    });
    const nestedContent = atlasNode("nested-content", 30, 30, {
      groupId: nestedFrame.id,
    });
    const nestedSibling = atlasNode("nested-sibling", 80, 30, {
      groupId: nestedFrame.id,
    });
    const outside = atlasNode("outside", 400, 0);
    const nodes = [
      frame,
      direct,
      nestedFrame,
      nestedContent,
      nestedSibling,
      outside,
    ];

    expect(
      collectAtlasGroupMembers(new Set([frame.id]), nodes).map(({ id }) => id),
    ).toEqual(["direct"]);
    expect(canAtlasGroupSelection(new Set(["direct", "outside"]), nodes)).toBe(
      true,
    );
    expect(
      canAtlasGroupSelection(
        new Set(["nested-content", "nested-sibling"]),
        nodes,
      ),
    ).toBe(false);
    expect(canAtlasUngroupSelection(new Set([nestedContent.id]), nodes)).toBe(
      true,
    );
    expect(canAtlasUngroupSelection(new Set([outside.id]), nodes)).toBe(false);
  });

  it("groups members while preserving surviving node data and edge identity", () => {
    const one = canvasNode("one", 10, 20, {
      metadata: { content: "preserve", fontSize: 17 },
    });
    const two = canvasNode("two", 140, 60);
    const outside = canvasNode("outside", 400, 40);
    const edges = [connection("one", "outside"), connection("two", "one")];
    const created = canvasNode("new-group", 0, 0, {
      type: CanvasNodeType.Group,
      width: 200,
      height: 150,
    });
    const nodes = [one, two, outside];
    const result = applyAtlasGroupSelection(
      new Set(["one", "two"]),
      nodes,
      edges,
      created,
    );

    expect(result?.nodes.map(({ id }) => id)).toEqual([
      "new-group",
      "one",
      "two",
      "outside",
    ]);
    expect(result?.nodes[1]).toMatchObject({
      metadata: { groupId: "new-group", content: "preserve", fontSize: 17 },
    });
    expect(result?.nodes[3]).toBe(outside);
    expect(result?.connections).toEqual(edges);
    expect(result?.connections[0]).toBe(edges[0]);
    expect(result?.selectedIds).toEqual(["new-group"]);
    expect(one.metadata?.groupId).toBeUndefined();
    expect(
      applyAtlasGroupSelection(new Set(["one", "two"]), nodes, edges, one),
    ).toBeNull();
  });

  it("ungroups a parent frame while retaining nested membership and internal links", () => {
    const outer = canvasNode("outer", 0, 0, {
      type: CanvasNodeType.Group,
      width: 500,
      height: 360,
    });
    const inner = canvasNode("inner", 30, 70, {
      type: CanvasNodeType.Group,
      metadata: { groupId: "outer" },
    });
    const nested = canvasNode("nested", 60, 110, {
      metadata: { groupId: "inner", content: "keep" },
    });
    const direct = canvasNode("direct", 360, 100, {
      metadata: { groupId: "outer" },
    });
    const edges = [
      connection("outer", "direct"),
      connection("inner", "nested"),
      connection("direct", "nested"),
    ];
    const nodes = [outer, inner, nested, direct];
    const result = applyAtlasUngroupSelection(new Set(["outer"]), nodes, edges);

    expect(result?.nodes.map(({ id }) => id)).toEqual([
      "inner",
      "nested",
      "direct",
    ]);
    expect(result?.nodes[0].metadata?.groupId).toBeUndefined();
    expect(result?.nodes[1].metadata).toMatchObject({
      groupId: "inner",
      content: "keep",
    });
    expect(result?.nodes[2].metadata?.groupId).toBeUndefined();
    expect(result?.connections).toEqual([edges[1], edges[2]]);
    expect(result?.selectedIds).toEqual(["inner", "direct"]);
    expect(outer.type).toBe(CanvasNodeType.Group);
    expect(direct.metadata?.groupId).toBe("outer");
  });

  it("clears an explicitly selected orphan without mutating cyclic group metadata", () => {
    const first = canvasNode("g1", 0, 0, {
      type: CanvasNodeType.Group,
      metadata: { groupId: "g2" },
    });
    const second = canvasNode("g2", 10, 10, {
      type: CanvasNodeType.Group,
      metadata: { groupId: "g1" },
    });
    const orphan = canvasNode("orphan", 30, 40, {
      metadata: { groupId: "missing", content: "keep" },
    });
    const nodes = [first, second, orphan];

    expect(
      applyAtlasUngroupSelection(new Set([orphan.id]), nodes, [])?.nodes[2]
        .metadata,
    ).toMatchObject({ content: "keep", groupId: undefined });
    expect(nodes[2].metadata?.groupId).toBe("missing");
  });

  it("fits overlays into small viewports and clamps malformed coordinates", () => {
    const fitted = fitAtlasViewportForNode(
      atlasNode("large", -1e12, 1e12, { width: 1e12, height: 1e12 }),
      { width: 320, height: 180 },
      { above: 30, below: 64, bottomInset: 40 },
    );
    expect(fitted.scale).toBeGreaterThanOrEqual(0.05);
    expect(fitted.scale).toBeLessThanOrEqual(1);
    expect([fitted.x, fitted.y, fitted.scale].every(Number.isFinite)).toBe(
      true,
    );

    const malformed = fitAtlasViewportForNode(
      atlasNode("invalid", Number.NaN, Number.POSITIVE_INFINITY, {
        width: Number.NaN,
        height: 0,
      }),
      { width: 0, height: 0 },
      { above: Number.POSITIVE_INFINITY },
    );
    expect(
      [malformed.x, malformed.y, malformed.scale].every(Number.isFinite),
    ).toBe(true);
    expect(malformed.scale).toBeGreaterThanOrEqual(0.05);
    expect(malformed.scale).toBeLessThanOrEqual(1);
  });
});
