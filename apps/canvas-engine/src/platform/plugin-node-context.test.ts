import { describe, expect, it, vi } from "vitest";

import { createAtlasNodeContext } from "@/atlas-engine/plugins/node-context";
import type { CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasNodeData } from "@/types/canvas";

vi.mock("@/atlas-engine/plugins/events", () => ({
  createAtlasPluginStorage: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  })),
  emitAtlasPluginEvent: vi.fn(),
  onAtlasPluginEvent: vi.fn(() => vi.fn()),
}));
vi.mock("@/atlas-engine/model/node-registry", () => ({
  getAtlasNodeOwner: vi.fn(() => "test-plugin"),
}));

const node = (id: string, type = "test-plugin:card"): CanvasNodeData => ({
  id,
  type,
  title: id,
  position: { x: 0, y: 0 },
  width: 100,
  height: 80,
});
const host = (getNode: CanvasPluginHost["getNode"]) =>
  ({
    getNode,
    getNodes: vi.fn(() => []),
    getConnections: vi.fn(() => []),
    getUpstream: vi.fn(() => []),
    getDownstream: vi.fn(() => []),
    updateNode: vi.fn(),
    updateMetadata: vi.fn(),
    applyOps: vi.fn(),
    ai: {},
    openPanel: vi.fn(),
    closePanel: vi.fn(),
  }) as unknown as CanvasPluginHost;

describe("plugin node context binding", () => {
  it("binds updates and panel actions to the node id that created the context", () => {
    const first = node("first");
    const second = node("second");
    const api = host((id) => (id === "first" ? first : second));
    const context = createAtlasNodeContext(api, first, {} as never, 1);

    context.updateNode({ title: "Updated" });
    context.updateMetadata({ content: "updated" });
    context.openPanel();
    context.closePanel();
    expect(api.updateNode).toHaveBeenCalledWith("first", { title: "Updated" });
    expect(api.updateMetadata).toHaveBeenCalledWith("first", {
      content: "updated",
    });
    expect(api.openPanel).toHaveBeenCalledWith("first");
    expect(api.closePanel).toHaveBeenCalledWith("first");
  });

  it("does not let a stale context mutate or focus a replacement of a different node type", () => {
    const original = node("stable-id", "test-plugin:card");
    let current: CanvasNodeData = original;
    const api = host(() => current);
    const context = createAtlasNodeContext(api, original, {} as never, 1);
    current = node("stable-id", "text");

    context.updateNode({ title: "Wrong node" });
    context.updateMetadata({ content: "Wrong node" });
    context.openPanel();
    context.closePanel();
    expect(api.updateNode).not.toHaveBeenCalled();
    expect(api.updateMetadata).not.toHaveBeenCalled();
    expect(api.openPanel).not.toHaveBeenCalled();
    expect(api.closePanel).not.toHaveBeenCalled();
    expect(context.getUpstream()).toEqual([]);
    expect(context.getDownstream()).toEqual([]);
  });
});
