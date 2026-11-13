import { describe, expect, it } from "vitest";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from "@/types/canvas";
import { fromCanvasDocument, toCanvasNodes } from "@/atlas-engine/adapter";
import { applyAtlasCommands } from "@/atlas-engine/reducer";
import {
  createAtlasHistory,
  recordAtlasSnapshot,
  redoAtlasHistory,
  undoAtlasHistory,
} from "@/atlas-engine/history/document-history";
import {
  atlasNodeCreationOpensPanel,
  planAtlasBatchImageDuplicate,
  planAtlasBatchImageRemoval,
  planAtlasBatchPrimary,
  planAtlasConnectedNode,
  planAtlasConnectionRemoval,
  planAtlasFragmentClone,
  planAtlasFragmentInsertion,
  planAtlasReferenceDisconnect,
} from "@/atlas-engine/interaction/node-commands";

const node = (
  id: string,
  type = CanvasNodeType.Text,
  x = 0,
): CanvasNodeData => ({
  id,
  type,
  title: id,
  position: { x, y: 0 },
  width: 100,
  height: 60,
  metadata: {},
});
const edge = (
  id: string,
  fromNodeId: string,
  toNodeId: string,
): CanvasConnection => ({ id, fromNodeId, toNodeId });

describe("atlas node command plans", () => {
  it("creates a connected node only when the connection contract is valid", () => {
    const source = node("source");
    const result = planAtlasConnectedNode(
      CanvasNodeType.Image,
      { x: 200, y: 40 },
      { nodeId: source.id, handleType: "source" },
      undefined,
      [source],
      () => "edge-1",
    );
    expect(result?.nodes).toHaveLength(1);
    expect(result?.connections).toEqual([
      expect.objectContaining({ id: "edge-1", fromNodeId: source.id }),
    ]);
    const before = fromCanvasDocument([source], [], { x: 0, y: 0, k: 1 });
    const committed = applyAtlasCommands(before, result!.commands);
    expect(committed.nodes).toHaveLength(2);
    expect(committed.edges).toEqual([
      { id: "edge-1", source: source.id, target: result!.nodes[0].id },
    ]);
    expect(committed.selection).toEqual({ nodeIds: [result!.nodes[0].id] });
    const withoutSource = fromCanvasDocument([], [], { x: 0, y: 0, k: 1 });
    expect(applyAtlasCommands(withoutSource, result!.commands)).toBe(
      withoutSource,
    );
    expect(
      planAtlasConnectedNode(
        CanvasNodeType.Config,
        { x: 200, y: 40 },
        { nodeId: "missing", handleType: "source" },
        undefined,
        [source],
        () => "edge-2",
      ),
    ).toBeNull();
  });

  it("clones selected graph nodes with fresh identifiers and internal edges", () => {
    const source = node("source");
    const target = node("target", CanvasNodeType.Image, 160);
    const result = planAtlasFragmentClone(
      [source, target],
      [edge("e", "source", "target")],
      new Set(["source", "target"]),
      { offset: { x: 40, y: 20 } },
    );
    expect(result?.nodes.map((item) => item.id)).not.toEqual([
      "source",
      "target",
    ]);
    expect(result?.connections).toHaveLength(1);
    expect(result?.connections[0].fromNodeId).not.toBe("source");
    expect(result?.connections[0].toNodeId).not.toBe("target");
  });

  it("keeps external references, remaps group membership, and never duplicates an active generation task", () => {
    const outside = node("reference", CanvasNodeType.Image);
    const group = node("group", CanvasNodeType.Group);
    const child = node("child", CanvasNodeType.Video, 120);
    child.metadata = {
      groupId: group.id,
      status: "loading",
      videoTaskId: "running",
      videoTaskProjectId: "project",
      videoTaskProvider: "platform",
    };
    const nodes = [outside, group, child];
    const links = [edge("ref", outside.id, child.id)];
    const plan = planAtlasFragmentClone(nodes, links, new Set([group.id]), {
      offset: { x: 36, y: 36 },
      preserveExternalGroups: true,
    })!;
    const copiedGroup = plan.nodes.find(
      (item) => item.type === CanvasNodeType.Group,
    )!;
    const copiedChild = plan.nodes.find(
      (item) => item.type === CanvasNodeType.Video,
    )!;
    expect(copiedChild.metadata).toMatchObject({
      groupId: copiedGroup.id,
      status: "idle",
    });
    expect(copiedChild.metadata?.videoTaskId).toBeUndefined();
    expect(plan.connections).toEqual([
      expect.objectContaining({
        fromNodeId: outside.id,
        toNodeId: copiedChild.id,
      }),
    ]);
    expect(child.metadata.videoTaskId).toBe("running");
    const before = fromCanvasDocument(nodes, links, { x: 0, y: 0, k: 1 });
    const after = applyAtlasCommands(before, plan.commands);
    const history = recordAtlasSnapshot(createAtlasHistory(before), after);
    const undone = undoAtlasHistory(history);
    expect(undone.present).toBe(before);
    expect(redoAtlasHistory(undone).present).toBe(after);
  });

  it("centers a pasted snapshot and ignores references that no longer exist", () => {
    const first = node("one", CanvasNodeType.Image);
    const second = node("two", CanvasNodeType.Text, 200);
    const pasted = planAtlasFragmentInsertion(
      {
        nodes: [first, second],
        connections: [edge("deleted-ref", "missing", first.id)],
      },
      [],
      { x: 500, y: 300 },
    )!;
    expect(pasted.connections).toEqual([]);
    const document = applyAtlasCommands(
      fromCanvasDocument([], [], { x: 0, y: 0, k: 1 }),
      pasted.commands,
    );
    const [a, b] = toCanvasNodes(document);
    expect((a.position.x + b.position.x + b.width) / 2).toBe(500);
    expect(a.position.y + a.height / 2).toBe(300);
  });

  it("removes a selected edge or reference pair without mutating the source", () => {
    const links = [edge("a", "one", "two"), edge("b", "one", "three")];
    expect(planAtlasConnectionRemoval("a")).toEqual([
      { type: "disconnect", edgeId: "a" },
    ]);
    expect(planAtlasReferenceDisconnect(links, "one", "three")).toEqual([
      { type: "disconnect", edgeId: "b" },
    ]);
    expect(links).toHaveLength(2);
    const before = fromCanvasDocument(
      [node("one"), node("two"), node("three")],
      links,
      { x: 0, y: 0, k: 1 },
      { nodeIds: ["one"], edgeId: "b" },
    );
    const after = applyAtlasCommands(
      before,
      planAtlasReferenceDisconnect(links, "one", "three"),
    );
    expect(after.selection).toEqual({ nodeIds: ["one"] });
    expect(after.edges.map((item) => item.id)).toEqual(["a"]);
  });

  it("duplicates a usable image variant and carries generation provenance", () => {
    const source = node("batch", CanvasNodeType.Image);
    source.metadata = {
      ...source.metadata,
      prompt: "sunrise",
      model: "platform::image",
      images: [
        {
          id: "v1",
          content: "/image",
          status: "success",
          naturalWidth: 400,
          naturalHeight: 200,
          bytes: 4,
          mimeType: "image/png",
        },
      ],
    };
    const copy = planAtlasBatchImageDuplicate(source, "v1", () => "copy");
    expect(copy).toMatchObject({
      id: "copy",
      type: CanvasNodeType.Image,
      metadata: {
        content: "/image",
        prompt: "sunrise",
        model: "platform::image",
      },
    });
    expect(
      planAtlasBatchImageDuplicate(source, "missing", () => "x"),
    ).toBeNull();
    expect(copy?.position.x).toBe(source.position.x + source.width * 2 + 96);
    expect(copy!.position.y + copy!.height / 2).toBe(
      source.position.y + source.height / 2,
    );
  });

  it("selects and removes variants through the shared node edit command", () => {
    const source = node("batch", CanvasNodeType.Image);
    source.metadata = {
      images: [
        {
          id: "v1",
          content: "/one",
          status: "success",
          naturalWidth: 100,
          naturalHeight: 100,
          bytes: 1,
          mimeType: "image/png",
        },
        {
          id: "v2",
          content: "/two",
          status: "success",
          naturalWidth: 100,
          naturalHeight: 100,
          bytes: 1,
          mimeType: "image/png",
        },
      ],
      primaryImageId: "v1",
      content: "/one",
    };
    const selected = planAtlasBatchPrimary([source], "batch", "v2");
    expect(selected[0].metadata?.primaryImageId).toBe("v2");
    const removed = planAtlasBatchImageRemoval(selected, "batch", "v2");
    expect(removed.shouldCollapse).toBe(true);
    expect(removed.nodes[0].metadata?.images).toHaveLength(1);
    expect(removed.nodes[0].metadata?.primaryImageId).toBe("v1");
  });

  it("retains builtin and plugin panel opening rules", () => {
    expect(atlasNodeCreationOpensPanel(CanvasNodeType.Image)).toBe(true);
    expect(atlasNodeCreationOpensPanel(CanvasNodeType.Text)).toBe(false);
    expect(atlasNodeCreationOpensPanel(CanvasNodeType.Group)).toBe(false);
    expect(
      atlasNodeCreationOpensPanel("plugin", {
        useBuiltinPanel: { mode: "image" },
      }),
    ).toBe(true);
    expect(
      atlasNodeCreationOpensPanel(CanvasNodeType.Image, { hidePanel: true }),
    ).toBe(false);
    expect(atlasNodeCreationOpensPanel("plugin", { Panel: () => null })).toBe(
      false,
    );
    expect(
      atlasNodeCreationOpensPanel("plugin", {
        Panel: () => null,
        autoOpenPanel: true,
      }),
    ).toBe(true);
  });
});
