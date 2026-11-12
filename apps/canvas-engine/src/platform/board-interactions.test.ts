import { describe, expect, it } from "vitest";

import {
  beginBoardNodeDrag,
  beginCanvasSelection,
  cancelBoardNodeDrag,
  finishBoardNodeDrag,
  selectBoardNode,
  updateBoardNodeDrag,
  updateCanvasSelection,
} from "@/product-engine/board-interactions";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function makeNode(
  id: string,
  x: number,
  y: number,
  options: {
    type?: CanvasNodeData["type"];
    width?: number;
    height?: number;
    groupId?: string;
  } = {},
): CanvasNodeData {
  return {
    id,
    type: options.type ?? CanvasNodeType.Image,
    title: id,
    position: { x, y },
    width: options.width ?? 40,
    height: options.height ?? 30,
    metadata: options.groupId ? { groupId: options.groupId } : undefined,
  };
}

describe("board pointer interactions", () => {
  it("tracks an additive marquee and keeps the prior selection as its base", () => {
    const nodes = [makeNode("inside", 20, 20), makeNode("outside", 140, 20)];
    const started = beginCanvasSelection(
      { x: 0, y: 0 },
      new Set(["kept"]),
      true,
      7,
    );

    const ignored = updateCanvasSelection(
      started.state,
      8,
      1,
      { x: 100, y: 100 },
      nodes,
    );
    expect(ignored.state).toBe(started.state);

    const updated = updateCanvasSelection(
      started.state,
      7,
      1,
      { x: 80, y: 70 },
      nodes,
    );
    expect(updated.box).toMatchObject({ currentWorldX: 80, currentWorldY: 70 });
    expect(updated.selection).toEqual(new Set(["kept", "inside"]));
  });

  it("toggles modifier selection but preserves a multi-selection on plain press", () => {
    const current = new Set(["first", "second"]);
    expect(selectBoardNode(current, "first", false)).toEqual(current);
    expect(selectBoardNode(current, "second", true)).toEqual(new Set(["first"]));
    expect(selectBoardNode(current, "third", false)).toEqual(new Set(["third"]));
  });

  it("includes direct group members in a group move and keeps their offsets", () => {
    const nodes = [
      makeNode("group", 0, 0, { type: CanvasNodeType.Group, width: 240, height: 180 }),
      makeNode("child-a", 30, 60, { groupId: "group" }),
      makeNode("child-b", 90, 60, { groupId: "group" }),
      makeNode("unrelated", 400, 20),
    ];
    const drag = beginBoardNodeDrag(nodes, new Set(["group"]), "group", { x: 10, y: 20 }, 1);

    const moved = updateBoardNodeDrag(drag, { x: 50, y: 30 }, 2, nodes);
    expect(moved.state.mode).toBe("node-drag");
    expect(moved.nodes.map(({ id, position }) => [id, position])).toEqual([
      ["group", { x: 20, y: 5 }],
      ["child-a", { x: 50, y: 65 }],
      ["child-b", { x: 110, y: 65 }],
      ["unrelated", { x: 400, y: 20 }],
    ]);
  });

  it("uses pointer-up coordinates to commit a drop into a group", () => {
    const nodes = [
      makeNode("moving", 10, 30),
      makeNode("target", 100, 0, { type: CanvasNodeType.Group, width: 220, height: 160 }),
    ];
    const drag = beginBoardNodeDrag(nodes, new Set(["moving"]), "moving", { x: 0, y: 0 }, 2);
    const preview = updateBoardNodeDrag(drag, { x: 80, y: 0 }, 2, nodes);
    expect(preview.dropTargetId).toBeNull();

    const result = finishBoardNodeDrag(preview.state, nodes, { x: 200, y: 0 }, 2);
    expect(result.moved).toBe(true);
    expect(result.nodes[0]).toMatchObject({
      position: { x: 124, y: 30 },
      metadata: { groupId: "target" },
    });
    expect(result.nodes[1]).toBe(nodes[1]);
  });

  it("does not move on a sub-threshold click and rolls previews back on cancel", () => {
    const nodes = [makeNode("a", 10, 20), makeNode("b", 80, 20)];
    const click = beginBoardNodeDrag(nodes, new Set(["a"]), "a", { x: 2, y: 3 }, 3);
    const clickResult = finishBoardNodeDrag(click, nodes, { x: 4, y: 5 }, 1);
    expect(clickResult).toMatchObject({ moved: false, clickedNodeId: "a" });
    expect(clickResult.nodes).toBe(nodes);

    const drag = beginBoardNodeDrag(nodes, new Set(["a", "b"]), "a", { x: 0, y: 0 }, 4);
    const preview = updateBoardNodeDrag(drag, { x: 30, y: 12 }, 1, nodes);
    const cancelled = cancelBoardNodeDrag(preview.state, preview.nodes);
    expect(cancelled.nodes.map((node) => node.position)).toEqual([
      { x: 10, y: 20 },
      { x: 80, y: 20 },
    ]);
    expect(cancelled.state).toEqual({ mode: "idle" });
  });
});
