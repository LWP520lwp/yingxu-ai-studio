import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyStudioPluginOperations,
  studioCompositionNode,
  studioPluginContext,
} from "@/atlas-engine/studio/studio-plugins";
import {
  StudioSession,
  makeStudioNode,
  type StudioDocument,
} from "@/atlas-engine/studio/studio-document";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";

const mocks = vi.hoisted(() => ({
  storage: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() })),
  generation: vi.fn((_config: unknown, ready: () => void) => ({
    generateText: async () => {
      ready();
      return { text: "ready" };
    },
  })),
}));
vi.mock("@/atlas-engine/plugins/events", () => ({
  createAtlasPluginStorage: mocks.storage,
  emitAtlasPluginEvent: vi.fn(),
  onAtlasPluginEvent: vi.fn(),
}));
vi.mock("@/atlas-engine/plugins/generation-adapter", () => ({
  createAtlasPluginGeneration: mocks.generation,
}));
vi.mock("@/atlas-engine/model/node-registry", () => ({
  getAtlasNodeOwner: () => "extension.owner",
  getAtlasNodeDefinition: () => undefined,
}));

const node = (id: string, type = "extension:card") => ({
  ...makeStudioNode(type, 0, 0, id),
  id,
});
const doc = (
  nodes: CanvasNodeData[],
  connections: StudioDocument["connections"] = [],
): StudioDocument => ({
  nodes,
  connections,
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: "lines",
  showImageInfo: true,
});
function context(session: StudioSession, source = session.read().nodes[0]) {
  let panel: string | null = null;
  const options = {
    config: {} as AiConfig,
    theme: "dark" as const,
    open: vi.fn((id: string | null) => {
      panel = id;
    }),
    close: vi.fn((id: string) => {
      if (panel === id) panel = null;
    }),
    generate: vi.fn(),
  };
  return {
    api: studioPluginContext(session, source, options),
    options,
    panel: () => panel,
  };
}
beforeEach(() => vi.clearAllMocks());

describe("extension contexts on the active Studio engine", () => {
  it("sees live graph and metadata updates without allowing a plugin to replace node identity or type", () => {
    const a = node("a"),
      b = node("b"),
      c = node("c");
    const session = new StudioSession(
      doc([a, b, c], [{ id: "ba", fromNodeId: "b", toNodeId: "a" }]),
    );
    const { api } = context(session);
    expect(api.getUpstream().map((n) => n.id)).toEqual(["b"]);
    expect(api.getDownstream()).toEqual([]);
    session.connect("a", "c");
    expect(api.getDownstream().map((n) => n.id)).toEqual(["c"]);
    api.updateNode({
      title: "edited",
      width: 420,
      height: 280,
      id: "hijack",
      type: "video",
      metadata: { content: "hidden" },
    } as never);
    api.updateMetadata({ content: "kept", prompt: "prompt" });
    expect(api.getNode("a")).toMatchObject({
      id: "a",
      type: "extension:card",
      title: "edited",
      width: 420,
      height: 280,
      metadata: { content: "kept", prompt: "prompt" },
    });
    expect(api.getNodes()).toBe(session.read().nodes);
    expect(api.getConnections()).toBe(session.read().connections);
    expect(api.getNode("absent")).toBeNull();
    const before = session.snapshot();
    api.updateNode({ width: NaN, height: -10 });
    expect(session.snapshot()).toBe(before);
    expect(mocks.storage).toHaveBeenCalledWith("extension.owner");
  });

  it("does not mutate, generate, navigate or expose peers from a stale or disposed node binding", async () => {
    const original = node("a");
    const session = new StudioSession(doc([original, node("b")]));
    const { api, options } = context(session);
    session.patch("a", { type: "text" });
    const before = session.read();
    api.updateNode({ title: "wrong type" });
    api.updateMetadata({ content: "wrong type" });
    api.openPanel();
    api.closePanel();
    api.applyOps([{ type: "delete_node", id: "b" }]);
    expect(session.read()).toBe(before);
    expect(api.getUpstream()).toEqual([]);
    expect(api.getDownstream()).toEqual([]);
    expect(options.open).not.toHaveBeenCalled();
    expect(options.close).not.toHaveBeenCalled();
    await expect(api.ai.generateText("blocked")).rejects.toThrow(
      "Canvas context changed",
    );
    const live = context(session, session.read().nodes[0]);
    session.dispose();
    live.api.applyOps([{ type: "add_node", nodeType: "image" }]);
    expect(session.read()).toBe(before);
    await expect(live.api.ai.generateText("blocked")).rejects.toThrow(
      "Canvas context changed",
    );
  });

  it("only closes the panel owned by its node and submits generation after applying the graph transaction", () => {
    const session = new StudioSession(doc([node("a"), node("b")]));
    const { api, options, panel } = context(session);
    api.openPanel();
    expect(panel()).toBe("a");
    options.open("b");
    api.closePanel();
    expect(panel()).toBe("b");
    api.openPanel();
    api.closePanel();
    expect(panel()).toBeNull();
    api.applyOps([
      { type: "add_node", id: "result", nodeType: "image", title: "Output" },
      { type: "connect_nodes", fromNodeId: "a", toNodeId: "result" },
      {
        type: "run_generation",
        nodeId: "result",
        mode: "image",
        prompt: "blue scene",
      },
    ]);
    expect(api.getNode("result")?.title).toBe("Output");
    expect(options.generate).toHaveBeenCalledWith(
      "result",
      "image",
      "blue scene",
    );
    session.undo();
    expect(api.getNode("result")).toBeNull();
    expect(session.read().connections).toHaveLength(0);
  });
});

describe("Studio extension operation transactions", () => {
  it("caps a single submission, retains generation requests and restores graph changes with one undo", () => {
    const session = new StudioSession(doc([node("a")]));
    const operations = Array.from({ length: 201 }, (_, index) => ({
      type: "add_node" as const,
      id: `out-${index}`,
      nodeType: "text",
    }));
    const pending = applyStudioPluginOperations(session, [
      { type: "run_generation", nodeId: "a", mode: "text", prompt: "draft" },
      ...operations,
    ]);
    expect(pending).toEqual([
      { type: "run_generation", nodeId: "a", mode: "text", prompt: "draft" },
    ]);
    expect(session.read().nodes).toHaveLength(200);
    expect(session.read().nodes.some((n) => n.id === "out-199")).toBe(false);
    session.undo();
    expect(session.read().nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("creates a sequence from playable videos and preserves source metadata without mutating the originals", () => {
    const videos = [node("v1", "video"), node("v2", "video")].map(
      (item, index) => ({
        ...item,
        metadata: {
          content: `/clip-${index}.mp4`,
          storageKey: `video:${index}`,
          durationMs: 5000,
          mimeType: "video/mp4",
        },
      }),
    );
    const snapshot = structuredClone(videos);
    expect(
      studioCompositionNode([videos[0], node("image", "image")], 1, 2),
    ).toBeNull();
    const sequence = studioCompositionNode(
      [...videos, node("unfinished", "video")],
      40,
      60,
    )!;
    expect(sequence.type).toBe("platform:composition");
    expect(sequence.position).toEqual({ x: 40, y: 60 });
    expect(sequence.metadata?.composition?.clips).toMatchObject([
      {
        sourceNodeId: "v1",
        url: "/clip-0.mp4",
        storageKey: "video:0",
        startMs: 0,
        endMs: null,
        volume: 1,
      },
      {
        sourceNodeId: "v2",
        url: "/clip-1.mp4",
        storageKey: "video:1",
        durationMs: 5000,
      },
    ]);
    expect(videos).toEqual(snapshot);
  });
});
