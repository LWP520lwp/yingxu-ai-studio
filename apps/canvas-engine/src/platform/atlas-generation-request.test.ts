import { describe, expect, it } from "vitest";

import { createCanvasResourceIndex } from "@/atlas-engine/model/resource-references";
import { resolveAtlasGenerationRequest } from "@/atlas-engine/workflows/generation-request";
import { buildAtlasGenerationConfig } from "@/atlas-engine/workflows/generation-runtime";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(
  id: string,
  type: CanvasNodeData["type"],
  metadata: CanvasNodeData["metadata"] = {},
): CanvasNodeData {
  return {
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    metadata,
  };
}

function resolve(
  patch: Partial<Parameters<typeof resolveAtlasGenerationRequest>[0]> = {},
) {
  const nodes = patch.nodes ?? [];
  const connections = patch.connections ?? [];
  const mode = patch.mode ?? "image";
  const sourceNode = patch.sourceNode;
  return resolveAtlasGenerationRequest({
    nodeId: "source",
    mode,
    prompt: "A quiet observatory",
    ...patch,
    sourceNode,
    nodes,
    connections,
    config: buildAtlasGenerationConfig(patch.config ?? defaultConfig, sourceNode, mode),
    overwriteExisting: false,
    resourceIndex: createCanvasResourceIndex(nodes, connections),
    formatTextEdit: (source, instruction) => `${source}\n\n${instruction}`,
  });
}

describe("Atlas generation request resolution", () => {
  it("routes plugin image tools to their own node and trims the scene prompt", () => {
    const plugin = node("source", "atlas:scene", {});
    const request = resolve({
      sourceNode: plugin,
      nodes: [plugin],
      prompt: "  Aurora over the ridge  ",
      builtinPanel: {
        mode: "image",
        promptPrefix: "cinematic: ",
        writeBackToSelf: true,
      },
    });

    expect(request).toMatchObject({
      kind: "plugin-image-writeback",
      nodeId: "source",
      scene: "Aurora over the ridge",
      panel: { promptPrefix: "cinematic: " },
      config: { model: "" },
    });
  });

  it("turns an existing text node into an edit request without marking it busy", () => {
    const source = node("source", CanvasNodeType.Text, {
      content: "The original paragraph",
    });
    const request = resolve({
      sourceNode: source,
      nodes: [source],
      mode: "text",
      prompt: "make it shorter",
    });

    expect(request).toMatchObject({
      kind: "node-generation",
      editingTextNode: true,
      markSourceStatus: false,
      context: { prompt: "The original paragraph\n\nmake it shorter" },
    });
  });

  it("blocks frame-based video before creating a task when no frames are connected", () => {
    const source = node("source", CanvasNodeType.Video, {
      videoMode: "frames",
    });
    const request = resolve({
      sourceNode: source,
      nodes: [source],
      mode: "video",
      prompt: "A continuous camera move",
    });

    expect(request).toMatchObject({
      kind: "node-generation",
      frameIssue: expect.any(String),
      context: { referenceImages: [] },
    });
  });
});
