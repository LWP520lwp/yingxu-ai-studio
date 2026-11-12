import { describe, expect, it, vi } from "vitest";

import { createCanvasPluginHostAdapter } from "@/lib/canvas/canvas-plugin-host";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { CanvasPluginAi } from "@/types/canvas-plugin";

const node = (id: string, type = "extension:card"): CanvasNodeData => ({
  id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 80, metadata: { content: id },
});
const edge = (fromNodeId: string, toNodeId: string, id = `${fromNodeId}-${toNodeId}`): CanvasConnection => ({ id, fromNodeId, toNodeId });
const ai = {
  generateImage: vi.fn(), generateVideo: vi.fn(), generateText: vi.fn(), listModels: vi.fn(), defaultModel: vi.fn(),
} as unknown as CanvasPluginAi;

describe("canvas plugin host adapter", () => {
  it("indexes upstream and downstream once per graph version, de-duplicates and skips dangling edges", () => {
    let nodes = [node("a"), node("b"), node("c"), node("d")];
    let connections = [edge("a", "c"), edge("a", "c", "duplicate"), edge("b", "c"), edge("c", "d"), edge("gone", "c")];
    const readNodes = vi.fn(() => nodes);
    const readConnections = vi.fn(() => connections);
    const host = createCanvasPluginHostAdapter({
      readNodes, readConnections, setNodes: vi.fn(), setDialogNodeId: vi.fn(), applyOps: vi.fn(), ai,
    });

    expect(host.getUpstream("c").map((item) => item.id)).toEqual(["a", "b"]);
    expect(host.getDownstream("a").map((item) => item.id)).toEqual(["c"]);
    expect(readNodes).toHaveBeenCalledTimes(2);
    expect(readConnections).toHaveBeenCalledTimes(2);

    nodes = [...nodes, node("e")];
    connections = [...connections, edge("c", "e")];
    expect(host.getDownstream("c").map((item) => item.id)).toEqual(["d", "e"]);
    expect(host.ai).toBe(ai);
  });

  it("whitelists node patches and immutably updates metadata", () => {
    const original = node("target");
    let current = [original, node("other")];
    const setNodes = vi.fn((update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => { current = update(current); });
    const host = createCanvasPluginHostAdapter({
      readNodes: () => current, readConnections: () => [], setNodes, setDialogNodeId: vi.fn(), applyOps: vi.fn(), ai,
    });

    host.updateNode("target", { id: "other", type: "text", title: "Renamed", width: 140, height: 90 } as never);
    expect(current[0]).toMatchObject({ id: "target", type: "extension:card", title: "Renamed", width: 140, height: 90 });
    expect(current[1].title).toBe("other");
    expect(current[0]).not.toBe(original);

    const updatedNode = current[0];
    host.updateMetadata("target", { content: "changed" });
    expect(current[0].metadata).toEqual({ content: "changed" });
    expect(current[0].metadata).not.toBe(updatedNode.metadata);
  });

  it("routes operation and panel controls without capturing stale node arrays", () => {
    const nodes = [node("one")];
    const operation: CanvasAgentOp = { type: "select_nodes", ids: ["one"] };
    const applyOps = vi.fn();
    let activeDialogNodeId: string | null = null;
    const setDialogNodeId = vi.fn((next: string | null | ((current: string | null) => string | null)) => {
      activeDialogNodeId = typeof next === "function" ? next(activeDialogNodeId) : next;
    });
    const host = createCanvasPluginHostAdapter({
      readNodes: () => nodes, readConnections: () => [], setNodes: vi.fn(), setDialogNodeId, applyOps, ai,
    });
    expect(host.getNode("one")).toBe(nodes[0]);
    expect(host.getNodes()).toBe(nodes);
    host.applyOps([operation]);
    host.openPanel("one");
    host.closePanel("two");
    expect(activeDialogNodeId).toBe("one");
    host.closePanel("one");
    expect(applyOps).toHaveBeenCalledWith([operation]);
    expect(activeDialogNodeId).toBeNull();
    host.closePanel();
    expect(activeDialogNodeId).toBeNull();
  });
});
