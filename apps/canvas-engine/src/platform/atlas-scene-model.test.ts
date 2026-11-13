import { describe, expect, it } from "vitest";

import {
  atlasMarqueeBounds,
  atlasSceneNodeView,
  type AtlasScenePresentation,
  type AtlasSceneReferences,
  type AtlasSceneSelection,
} from "@/atlas-engine/surface/scene-model";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node: CanvasNodeData = {
  id: "subject",
  type: CanvasNodeType.Image,
  title: "Subject",
  position: { x: -120, y: 80 },
  width: 240,
  height: 160,
};
const selection: AtlasSceneSelection = {
  nodes: new Set([node.id]),
  relatedNodes: new Set([node.id]),
  relatedEdges: new Set(),
  focused: node.id,
  edge: null,
};
const presentation: AtlasScenePresentation = {
  scale: 0.5,
  panelWidth: 480,
  panelNode: node.id,
  resizing: false,
  selecting: false,
  imageInfo: true,
  dropGroup: null,
  expanded: new Set([node.id]),
  childCounts: new Map([[node.id, 3]]),
  mentions: new Map(),
};
const references: AtlasSceneReferences = {
  owner: null,
  connected: new Set(),
  accepts: () => true,
};

describe("Atlas scene projection", () => {
  it("retains selection, batch expansion, related focus and node panel policy", () => {
    const view = atlasSceneNodeView(
      node,
      selection,
      presentation,
      references,
      null,
      true,
    );
    expect(view).toMatchObject({
      data: node,
      isSelected: true,
      isRelated: true,
      isFocusRelated: true,
      groupChildCount: 3,
      batchExpanded: true,
      showImageInfo: true,
      showPanel: true,
      scale: 0.5,
      panelWidth: 480,
    });
    expect(view.mentionReferences).toBe(
      atlasSceneNodeView(node, selection, presentation, references, null, true)
        .mentionReferences,
    );
  });

  it.each([
    { allowed: false, resizing: false, selecting: false },
    { allowed: true, resizing: true, selecting: false },
    { allowed: true, resizing: false, selecting: true },
  ])(
    "hides a panel during a conflicting interaction: %o",
    ({ allowed, ...changes }) => {
      expect(
        atlasSceneNodeView(
          node,
          selection,
          { ...presentation, ...changes },
          references,
          null,
          allowed,
        ).showPanel,
      ).toBe(false);
    },
  );

  it("distinguishes reference owner, unavailable input and eligible reference", () => {
    const view = (overrides: Partial<AtlasSceneReferences>) =>
      atlasSceneNodeView(
        node,
        selection,
        presentation,
        { ...references, owner: "other", ...overrides },
        { source: "other", target: node.id },
        true,
      );
    expect(view({ owner: node.id }).referenceSelectionState).toBe("target");
    expect(
      view({ connected: new Set([node.id]) }).referenceSelectionState,
    ).toBe("disabled");
    expect(view({ accepts: () => false }).referenceSelectionState).toBe(
      "disabled",
    );
    expect(view({})).toMatchObject({
      referenceSelectionState: "available",
      isConnectionTarget: true,
      isConnecting: true,
    });
  });

  it("keeps marquee bounds in world coordinates for every drag direction", () => {
    expect(
      atlasMarqueeBounds({
        startWorldX: 100,
        startWorldY: -40,
        currentWorldX: -20,
        currentWorldY: 50,
        additive: false,
        initialSelectedNodeIds: [],
      }),
    ).toEqual({ left: -20, top: -40, width: 120, height: 90 });
  });
});
