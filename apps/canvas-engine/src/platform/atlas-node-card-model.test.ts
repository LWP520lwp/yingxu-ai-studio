import { describe, expect, it } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { deriveAtlasNodeCardState, resolveAtlasResize } from "@/atlas-engine/surface/atlas-node-card-model";

const node: CanvasNodeData = {
  id: "image-1",
  type: CanvasNodeType.Image,
  title: "Image",
  position: { x: 100, y: 80 },
  width: 320,
  height: 180,
  metadata: { images: [{ id: "primary", content: "blob:preview", status: "success", naturalWidth: 1600, naturalHeight: 900, bytes: 200, mimeType: "image/png" }], primaryImageId: "primary" },
};

describe("Atlas node card model", () => {
  it("derives media behavior and reference-selection affordances", () => {
    const state = deriveAtlasNodeCardState({
      node,
      selected: false,
      focusRelated: false,
      connectionTarget: false,
      connecting: false,
      hovered: true,
      editingTitle: false,
      groupDropTarget: false,
      referenceMode: "available",
      showImageInfo: true,
    });
    expect(state.hasImage).toBe(true);
    expect(state.keepAspectRatio).toBe(true);
    expect(state.showImageInfo).toBe(true);
    expect(state.showReferenceOverlay).toBe(true);
    expect(state.showConnectionHandles).toBe(false);
  });

  it("resizes from the upper left while preserving the opposite corner and ratio", () => {
    const result = resolveAtlasResize({
      corner: "top-left",
      start: { x: 0, y: 0 },
      pointer: { x: -32, y: -18 },
      position: node.position,
      size: { width: 320, height: 180 },
      scale: 1,
      keepRatio: true,
      ratio: 16 / 9,
    });
    expect(result.width).toBeCloseTo(352);
    expect(result.height).toBeCloseTo(198);
    expect(result.position.x + result.width).toBeCloseTo(420);
    expect(result.position.y + result.height).toBeCloseTo(260);
  });
});
