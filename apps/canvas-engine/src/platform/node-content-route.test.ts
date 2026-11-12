import { describe, expect, it } from "vitest";

import { resolveNodeContentRoute } from "@/components/canvas/node-content/content-route";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(
  type: CanvasNodeData["type"],
  metadata: CanvasNodeData["metadata"] = {},
): CanvasNodeData {
  return {
    id: "node",
    type,
    title: "node",
    position: { x: 0, y: 0 },
    width: 300,
    height: 200,
    metadata,
  };
}

const route = (
  value: CanvasNodeData,
  overrides: Partial<Parameters<typeof resolveNodeContentRoute>[0]> = {},
) =>
  resolveNodeContentRoute({
    node: value,
    isBatchRoot: false,
    hasCustomConfigContent: false,
    hasPluginRenderer: false,
    ...overrides,
  });

describe("node content routing", () => {
  it("prioritizes explicit config content and image batches", () => {
    expect(
      route(node(CanvasNodeType.Config, { status: "error" }), {
        hasCustomConfigContent: true,
      }),
    ).toEqual({ kind: "custom-config" });
    expect(
      route(node(CanvasNodeType.Image, { status: "loading" }), {
        isBatchRoot: true,
      }),
    ).toEqual({ kind: "batch", nodeType: CanvasNodeType.Image });
  });

  it("keeps text batch content visible when one slot failed", () => {
    expect(
      route(
        node(CanvasNodeType.Text, {
          status: "error",
          texts: [
            { id: "failed", content: "", status: "error" },
            { id: "ready", content: "已生成", status: "success" },
          ],
        }),
      ),
    ).toEqual({ kind: "batch", nodeType: CanvasNodeType.Text });
  });

  it("shows generation status before builtin renderers", () => {
    expect(route(node(CanvasNodeType.Video, { status: "loading" }))).toEqual({
      kind: "status",
      status: "loading",
    });
    expect(route(node(CanvasNodeType.Audio, { status: "error" }))).toEqual({
      kind: "status",
      status: "error",
    });
  });

  it("distinguishes builtin, available plugin and missing plugin content", () => {
    expect(route(node(CanvasNodeType.Group))).toEqual({
      kind: "builtin",
      nodeType: CanvasNodeType.Group,
    });
    const extensionNode = node("extension:test");
    expect(route(extensionNode, { hasPluginRenderer: true })).toEqual({
      kind: "plugin",
    });
    expect(route(extensionNode)).toEqual({ kind: "missing-plugin" });
  });
});
