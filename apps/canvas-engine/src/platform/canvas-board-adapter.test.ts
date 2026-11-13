import { describe, expect, it } from "vitest";
import {
  beginBoardNodeDrag,
  cancelBoardNodeDrag,
  updateBoardNodeDrag,
} from "@/atlas-engine/interaction/canvas-board-adapter";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(
  id: string,
  type: CanvasNodeData["type"],
  x: number,
  metadata?: CanvasNodeData["metadata"],
): CanvasNodeData {
  return {
    id,
    type,
    title: id,
    position: { x, y: 10 },
    width: 100,
    height: 80,
    metadata,
  };
}

describe("canvas board adapter", () => {
  it("preserves application data while projecting group movement through Atlas", () => {
    const group = node("group", CanvasNodeType.Group, 0);
    const child = node("child", CanvasNodeType.Image, 20, {
      groupId: "group",
      prompt: "keep this metadata",
    });
    const untouched = node("untouched", CanvasNodeType.Video, 400, {
      prompt: "preserve reference",
    });
    const originals = [group, child, untouched];
    const drag = beginBoardNodeDrag(originals, new Set([group.id]), group.id, { x: 0, y: 0 }, 1);
    const preview = updateBoardNodeDrag(drag, { x: 20, y: 10 }, 2, originals);

    expect(preview.nodes.map(({ id, position }) => [id, position])).toEqual([
      ["group", { x: 10, y: 15 }],
      ["child", { x: 30, y: 15 }],
      ["untouched", { x: 400, y: 10 }],
    ]);
    expect(preview.nodes[1].metadata).toEqual(child.metadata);
    expect(preview.nodes[2]).toBe(untouched);

    const cancelled = cancelBoardNodeDrag(preview.state, preview.nodes);
    expect(cancelled.nodes).toEqual(originals);
  });
});
