import { describe, expect, it } from "vitest";

import {
  contentSlotState,
  expandedBatchCardPosition,
  primaryImageSlot,
  primaryTextSlot,
} from "@/components/canvas/node-content/slot-view-model";
import {
  buildCanvasNodeViewModel as buildCanvasNodeShellViewModel,
  claimCanvasNodeTitleSettlement,
  normalizeCanvasNodeTitle,
} from "@/components/canvas/node-content/canvas-node-view-model";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
  return {
    id: "node-1",
    type: CanvasNodeType.Image,
    title: "Result",
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata,
  };
}

function viewModel(
  value: CanvasNodeData,
  overrides: Partial<Parameters<typeof buildCanvasNodeShellViewModel>[0]> = {},
) {
  return buildCanvasNodeShellViewModel({
    node: value,
    isSelected: false,
    isFocusRelated: false,
    isConnectionTarget: false,
    isConnecting: false,
    isHovered: false,
    isEditingTitle: false,
    isGroupDropTarget: false,
    hasReferenceSelection: false,
    referenceSelectionAvailable: false,
    showImageInfo: false,
    ...overrides,
  });
}

describe("node content view model", () => {
  it("uses the selected image slot and never substitutes stale parent content", () => {
    const result = primaryImageSlot(
      node({
        content: "stale-parent-image",
        primaryImageId: "selected",
        images: [
          {
            id: "first",
            status: "success",
            content: "first-image",
            naturalWidth: 100,
            naturalHeight: 100,
            bytes: 100,
            mimeType: "image/png",
          },
          {
            id: "selected",
            status: "error",
            content: "",
            naturalWidth: 0,
            naturalHeight: 0,
            bytes: 0,
            mimeType: "image/png",
          },
        ],
      }),
    );

    expect(result.image?.id).toBe("selected");
    expect(result.content).toBe("");
  });

  it("uses legacy parent content only when no selected image slot exists", () => {
    expect(primaryImageSlot(node({ content: "legacy-image" }))).toEqual({
      image: undefined,
      content: "legacy-image",
    });
  });

  it("uses the selected text slot and preserves an empty failure state", () => {
    const result = primaryTextSlot(
      node({
        content: "stale-parent-text",
        primaryTextId: "selected",
        texts: [
          { id: "first", status: "success", content: "first text" },
          { id: "selected", status: "error", content: "" },
        ],
      }),
    );

    expect(result.text?.id).toBe("selected");
    expect(result.content).toBe("");
  });

  it("classifies content, active generation, failure and empty slots separately", () => {
    expect(contentSlotState("success", "ready")).toBe("content");
    expect(contentSlotState("loading", "")).toBe("loading");
    expect(contentSlotState("error", "")).toBe("error");
    expect(contentSlotState("success", "")).toBe("empty");
    expect(contentSlotState("idle", undefined)).toBe("empty");
  });

  it("lays out expanded batch cards without taking the selected result slot", () => {
    for (const itemCount of [2, 5, 9]) {
      const positions = Array.from({ length: itemCount - 1 }, (_, index) =>
        expandedBatchCardPosition(index, itemCount, 320, 180),
      );
      const keys = positions.map(({ x, y }) => `${x}:${y}`);

      expect(new Set(keys).size).toBe(itemCount - 1);
      expect(keys).not.toContain("0:0");
      expect(positions.every(({ x, y }) => x >= 0 && y <= 0)).toBe(true);
    }
    expect(expandedBatchCardPosition(0, 1, 320, 180)).toEqual({ x: 0, y: 0 });
  });

  it("derives media, batch, overlay and handle state for the node shell", () => {
    const mediaNode = node({
      primaryImageId: "chosen",
      images: [
        {
          id: "chosen",
          status: "success",
          content: "chosen-image",
          naturalWidth: 320,
          naturalHeight: 180,
          bytes: 10,
          mimeType: "image/png",
        },
        {
          id: "other",
          status: "success",
          content: "other-image",
          naturalWidth: 320,
          naturalHeight: 180,
          bytes: 10,
          mimeType: "image/png",
        },
      ],
    });
    const state = viewModel(mediaNode, {
      isSelected: true,
      isConnecting: true,
      showImageInfo: true,
    });

    expect(state).toMatchObject({
      hasImageContent: true,
      batchCount: 2,
      isBatchRoot: true,
      showImageInfo: true,
      showTitle: true,
      showConnectionHandles: true,
      connectionHandlesVisible: true,
      showSourceHandle: true,
      showFooterFade: false,
    });
  });

  it("keeps empty content interactive and honors plugin interaction and aspect rules", () => {
    const content = node({ content: "plugin-content", interactive: false });
    const toggleDefinition = {
      interactionToggle: true,
      transparentBackground: true,
      keepAspectRatio: () => true,
      hasSourceHandle: false,
    } as const;

    expect(viewModel(content, { definition: toggleDefinition })).toMatchObject({
      contentInteractive: false,
      transparentBackground: true,
      keepAspectRatio: true,
      showSourceHandle: false,
    });
    expect(
      viewModel(content, {
        definition: { ...toggleDefinition, forceInteractive: () => true },
      }).contentInteractive,
    ).toBe(true);
    expect(
      viewModel(node(), { definition: toggleDefinition }).contentInteractive,
    ).toBe(true);
  });

  it("keeps config output handles hidden and changes reference overlays only when needed", () => {
    const config = node();
    config.type = CanvasNodeType.Config;
    expect(viewModel(config)).toMatchObject({
      showConnectionHandles: true,
      showSourceHandle: false,
    });
    expect(
      viewModel(config, {
        hasReferenceSelection: true,
        referenceSelectionAvailable: true,
      }),
    ).toMatchObject({
      showTitle: false,
      showReferenceOverlay: false,
      showConnectionHandles: false,
      showSourceHandle: false,
    });
    expect(
      viewModel(config, {
        hasReferenceSelection: true,
        referenceSelectionAvailable: false,
      }).showReferenceOverlay,
    ).toBe(true);
  });

  it("normalizes title commits while retaining the existing fallback", () => {
    expect(normalizeCanvasNodeTitle("  新名称  ", "旧名称", "未命名")).toBe(
      "新名称",
    );
    expect(normalizeCanvasNodeTitle("   ", "旧名称", "未命名")).toBe("旧名称");
    expect(normalizeCanvasNodeTitle("", "", "未命名")).toBe("未命名");
    expect(normalizeCanvasNodeTitle("x".repeat(70), "旧名称", "未命名")).toBe(
      "x".repeat(64),
    );
  });

  it("settles a title edit once so Escape cannot be followed by a blur commit", () => {
    const session = { current: false };

    expect(claimCanvasNodeTitleSettlement(session)).toBe(true);
    expect(claimCanvasNodeTitleSettlement(session)).toBe(false);

    session.current = false;
    expect(claimCanvasNodeTitleSettlement(session)).toBe(true);
  });
});
