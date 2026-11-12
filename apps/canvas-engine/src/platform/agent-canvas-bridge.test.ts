import { describe, expect, it } from "vitest";

import { executeAgentCanvasTransaction } from "@/lib/agent-canvas-bridge";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType } from "@/types/canvas";

const snapshot = (): CanvasAgentSnapshot => ({
  projectId: "project",
  title: "Project",
  nodes: [
    {
      id: "image",
      type: CanvasNodeType.Image,
      title: "Image",
      position: { x: 0, y: 0 },
      width: 340,
      height: 240,
      metadata: { generationMode: "image", composerContent: "image prompt" },
    },
    {
      id: "text",
      type: CanvasNodeType.Text,
      title: "Text",
      position: { x: 400, y: 0 },
      width: 340,
      height: 240,
      metadata: { generationMode: "text", prompt: "text prompt" },
    },
  ],
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
});

describe("agent canvas transaction", () => {
  it("resolves generation against the post-operation graph and drops removed targets", () => {
    const before = snapshot();
    const result = executeAgentCanvasTransaction(before, [
      { type: "delete_node", id: "image" },
      { type: "run_generation", nodeId: "image" },
      { type: "run_generation", nodeId: "text" },
    ]);

    expect(result.changed).toBe(true);
    expect(result.generation).toEqual([
      { nodeId: "text", mode: "text", prompt: "text prompt" },
    ]);
    expect(result.after.nodes.map(({ id }) => id)).toEqual(["text"]);
  });

  it("uses explicit prompts and ignores missing or empty generation targets", () => {
    const before = snapshot();
    before.nodes[0].metadata = {};
    const result = executeAgentCanvasTransaction(before, [
      { type: "run_generation", nodeId: "image", mode: "video", prompt: "  shot prompt  " },
      { type: "run_generation", nodeId: "image" },
      { type: "run_generation", nodeId: "missing", prompt: "ignored" },
    ]);

    expect(result.changed).toBe(false);
    expect(result.generation).toEqual([
      { nodeId: "image", mode: "video", prompt: "  shot prompt  " },
    ]);
  });

  it("does not treat an ineffective operation as a document mutation", () => {
    const before = snapshot();
    const result = executeAgentCanvasTransaction(before, [
      { type: "delete_node", id: "missing" },
      { type: "connect_nodes", fromNodeId: "image", toNodeId: "missing" },
      { type: "select_nodes", ids: [] },
    ]);

    expect(result.changed).toBe(false);
    expect(result.after.nodes).toBe(before.nodes);
    expect(result.after.connections).toBe(before.connections);
  });
});
