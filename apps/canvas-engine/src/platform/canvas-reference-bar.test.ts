import { describe, expect, it } from "vitest";

import {
  canSwapFrameDrop,
  createReferenceItems,
  expandReferenceSources,
  referenceSourcesToDisconnect,
} from "@/atlas-engine/ui/canvas-reference-bar";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(
  id: string,
  type: CanvasNodeType = CanvasNodeType.Image,
  groupId?: string,
): CanvasNodeData {
  return {
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 120,
    height: 80,
    metadata: groupId
      ? { groupId, content: `data:${id}` }
      : { content: `data:${id}` },
  };
}

describe("canvas reference bar model", () => {
  it("expands nested group resources while retaining their connection source", () => {
    const group = node("group", CanvasNodeType.Group);
    const nested = node("nested", CanvasNodeType.Group, "group");
    const image = node("image", CanvasNodeType.Image, "nested");
    const text = node("text", CanvasNodeType.Text, "nested");

    expect(
      expandReferenceSources([group], [group, nested, image, text]),
    ).toEqual([
      { node: image, sourceNodeId: "group" },
      { node: text, sourceNodeId: "group" },
    ]);
  });

  it("deduplicates frame thumbnails, applies reversed frame labels and preserves ordinary duplicates", () => {
    const a = node("a");
    const b = node("b");
    const references = [
      { node: a, sourceNodeId: "group-1" },
      { node: a, sourceNodeId: "group-2" },
      { node: b, sourceNodeId: "group-1" },
    ];

    expect(createReferenceItems(references, true, ["a", "b"], true)).toEqual([
      { node: a, sourceNodeId: "group-2", frameLabel: "尾帧" },
      { node: b, sourceNodeId: "group-1", frameLabel: "首帧" },
    ]);
    expect(
      createReferenceItems(references, false, ["a", "b"], false),
    ).toHaveLength(3);
  });

  it("removes every parent connection for a deduplicated frame resource", () => {
    const image = node("image");
    const references = [
      { node: image, sourceNodeId: "group-1" },
      { node: image, sourceNodeId: "group-2" },
    ];

    expect(
      referenceSourcesToDisconnect(references, "image", "group-1", true),
    ).toEqual(["group-1", "group-2"]);
    expect(
      referenceSourcesToDisconnect(references, "image", "group-1", false),
    ).toEqual(["group-1"]);
  });

  it("allows frame drag swaps only between the complete two-image frame set", () => {
    expect(canSwapFrameDrop(["first", "last"], "first", "last")).toBe(true);
    expect(canSwapFrameDrop(["first", "last"], "first", "first")).toBe(false);
    expect(canSwapFrameDrop(["first"], "first", "last")).toBe(false);
    expect(canSwapFrameDrop(["first", "last", "extra"], "first", "last")).toBe(
      false,
    );
    expect(canSwapFrameDrop(["first", "last"], "other", "last")).toBe(false);
  });
});
