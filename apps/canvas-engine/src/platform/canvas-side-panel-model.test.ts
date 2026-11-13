import { describe, expect, it } from "vitest";

import {
  deriveCanvasNodePanelModel,
  toggleCanvasNodeSelection,
  toggleVisibleCanvasNodeSelection,
} from "@/atlas-engine/ui/canvas-side-panel-model";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(
  id: string,
  type: CanvasNodeType,
  metadata: CanvasNodeData["metadata"] = {},
  title = id,
): CanvasNodeData {
  return {
    id,
    type,
    title,
    position: { x: 0, y: 0 },
    width: 160,
    height: 120,
    metadata,
  };
}

describe("canvas side panel model", () => {
  it("keeps matching group children visible while respecting collapsed groups", () => {
    const nodes = [
      node("group", CanvasNodeType.Group),
      node("image", CanvasNodeType.Image, {
        groupId: "group",
        prompt: "aurora",
      }),
      node("text", CanvasNodeType.Text, { content: "A field guide" }),
      node("other", CanvasNodeType.Video),
    ];

    const expanded = deriveCanvasNodePanelModel(nodes, {
      query: "aurora",
      typeFilter: "all",
      collapsedGroupIds: new Set(),
    });
    expect(expanded.filteredNodes.map(({ id }) => id)).toEqual(["image"]);
    expect(
      expanded.rows.map(({ node: item, depth }) => [item.id, depth]),
    ).toEqual([
      ["group", 0],
      ["image", 1],
    ]);

    const collapsed = deriveCanvasNodePanelModel(nodes, {
      query: "aurora",
      typeFilter: "all",
      collapsedGroupIds: new Set(["group"]),
    });
    expect(collapsed.rows.map(({ node: item }) => item.id)).toEqual(["group"]);
  });

  it("does not index encoded media payloads as searchable text", () => {
    const nodes = [
      node("image", CanvasNodeType.Image, {
        content: "data:image/png;base64,SECRET",
      }),
      node("copy", CanvasNodeType.Text, { content: "SECRET" }),
    ];

    const result = deriveCanvasNodePanelModel(nodes, {
      query: "secret",
      typeFilter: "all",
      collapsedGroupIds: new Set(),
    });
    expect(result.filteredNodes.map(({ id }) => id)).toEqual(["copy"]);
  });

  it("toggles only the visible selection and retains hidden selected nodes", () => {
    const selected = new Set(["hidden", "one"]);
    const next = toggleVisibleCanvasNodeSelection(selected, ["one", "two"]);
    expect([...next].sort()).toEqual(["hidden", "one", "two"]);
    expect(toggleVisibleCanvasNodeSelection(next, ["one", "two"])).toEqual(
      new Set(["hidden"]),
    );
    expect(toggleCanvasNodeSelection(next, "two")).toEqual(
      new Set(["hidden", "one"]),
    );
  });
});
