import { describe, expect, it } from "vitest";
import {
  atlasInteractionOwnsPointer,
  beginAtlasNodeDrag,
  beginAtlasSelection,
  cancelAtlasNodeDrag,
  finishAtlasNodeDrag,
  finishAtlasSelection,
  selectAtlasNode,
  updateAtlasNodeDrag,
  updateAtlasSelection,
  type AtlasBoardNode,
} from "@/atlas-engine/interaction/board-interactions";

const node = (
  id: string,
  x: number,
  y: number,
  options: Partial<AtlasBoardNode> = {},
): AtlasBoardNode => ({
  id,
  kind: "text",
  position: { x, y },
  width: 80,
  height: 60,
  ...options,
});

describe("Atlas board interactions", () => {
  it("supports additive selection and reverse-direction marquee intersection", () => {
    const a = node("a", 10, 10);
    const b = node("b", 120, 10);
    const started = beginAtlasSelection({ x: 100, y: 90 }, new Set(["b"]), true, 7);
    const preview = updateAtlasSelection(
      started.state,
      7,
      1,
      { x: 0, y: 0 },
      [a, b],
    );

    expect(preview.selection).toEqual(new Set(["a", "b"]));
    expect(finishAtlasSelection(started.state, 6, { x: 0, y: 0 }, [a, b]).state).toBe(started.state);
    expect(selectAtlasNode(new Set(["a"]), "b", true)).toEqual(new Set(["a", "b"]));
    expect(selectAtlasNode(new Set(["a", "b"]), "a", true)).toEqual(new Set(["b"]));
  });

  it("accepts marquee release only from its initiating pointer", () => {
    const state = beginAtlasSelection({ x: 0, y: 0 }, new Set(), false, 18).state;

    expect(atlasInteractionOwnsPointer(state, 18)).toBe(true);
    expect(atlasInteractionOwnsPointer(state, 19)).toBe(false);
  });

  it("uses a screen-space movement threshold and returns a click when the gesture stays below it", () => {
    const item = node("item", 0, 0);
    const state = beginAtlasNodeDrag([item], new Set(["item"]), "item", { x: 20, y: 30 }, 11);
    const preview = updateAtlasNodeDrag(state, { x: 23, y: 30 }, 1, [item]);
    expect(preview.state).toMatchObject({ mode: "node-drag", hasMoved: false });

    const finished = finishAtlasNodeDrag(state, [item], { x: 23, y: 30 }, 1);
    expect(finished.moved).toBe(false);
    expect(finished.clickedNodeId).toBe("item");
  });

  it("moves selected group members together and cancellation restores their starting frames", () => {
    const group = node("group", 0, 0, { kind: "group", width: 300, height: 220 });
    const child = node("child", 40, 50, { metadata: { groupId: "group" } });
    const outside = node("outside", 500, 0);
    const state = beginAtlasNodeDrag([group, child, outside], new Set(["group"]), "group", { x: 10, y: 10 }, 12);
    const moved = updateAtlasNodeDrag(state, { x: 40, y: 30 }, 2, [group, child, outside]);

    expect(moved.nodes.map(({ id, position }) => [id, position])).toEqual([
      ["group", { x: 15, y: 10 }],
      ["child", { x: 55, y: 60 }],
      ["outside", { x: 500, y: 0 }],
    ]);
    expect(cancelAtlasNodeDrag(state, moved.nodes).nodes).toEqual([group, child, outside]);
  });

  it("snaps a dropped node into the topmost group and updates its membership", () => {
    const outer = node("outer", 0, 0, { kind: "group", width: 500, height: 400 });
    const inner = node("inner", 100, 80, { kind: "group", width: 220, height: 180 });
    const item = node("item", 80, 120, { width: 260, height: 40 });
    const state = beginAtlasNodeDrag([outer, inner, item], new Set(["item"]), "item", { x: 0, y: 0 }, 13);
    const result = finishAtlasNodeDrag(state, [outer, inner, item], { x: 5, y: 0 }, 1);
    const placed = result.nodes.find(({ id }) => id === "item");

    expect(result.moved).toBe(true);
    expect(result.clickedNodeId).toBeNull();
    expect(placed?.metadata?.groupId).toBe("inner");
    expect(placed?.position).toEqual({ x: 124, y: 120 });
  });
});
