import { describe, expect, it } from "vitest";

import {
  captureAtlasFragment as captureCanvasFragment,
  placeAtlasFragment as placeCanvasFragment,
} from "@/atlas-engine/interaction/node-layout";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node = (
  id: string,
  type: CanvasNodeData["type"] = CanvasNodeType.Text,
  groupId?: string,
): CanvasNodeData => ({
  id,
  type,
  title: id,
  width: 100,
  height: 80,
  position: { x: 10, y: 20 },
  metadata: { groupId, content: "original", references: ["asset:1"] },
});
const edge = (id: string, fromNodeId: string, toNodeId: string) => ({
  id,
  fromNodeId,
  toNodeId,
});
const idFactory = () => {
  let next = 0;
  return () => `copy-${++next}`;
};

describe("canvas fragment snapshots", () => {
  it("captures nested groups once, including cyclic group metadata, and isolates nested metadata", () => {
    const nodes = [
      node("group", CanvasNodeType.Group, "inner"),
      node("inner", CanvasNodeType.Group, "group"),
      node("child", CanvasNodeType.Image, "inner"),
      node("outside"),
    ];
    const fragment = captureCanvasFragment(
      nodes,
      [edge("ref", "outside", "child"), edge("out", "child", "outside")],
      new Set(["group"]),
    );
    expect(fragment?.nodes.map((item) => item.id)).toEqual([
      "group",
      "inner",
      "child",
    ]);
    expect(fragment?.connections.map((item) => item.id)).toEqual(["ref"]);
    nodes[2].metadata!.references!.push("mutated");
    expect(fragment?.nodes[2].metadata?.references).toEqual(["asset:1"]);
  });

  it("centers an entire copied group and maps its membership and internal edges", () => {
    const nodes = [
      node("group", CanvasNodeType.Group),
      node("child", CanvasNodeType.Image, "group"),
    ];
    const fragment = captureCanvasFragment(
      nodes,
      [edge("link", "group", "child")],
      new Set(["group"]),
    )!;
    const result = placeCanvasFragment(fragment, {
      center: { x: 500, y: 400 },
      existingNodes: nodes,
      idFactory: idFactory(),
    });
    expect(result.nodes[0].position).toEqual({ x: 450, y: 360 });
    expect(result.nodes[1].metadata?.groupId).toBe("copy-1");
    expect(result.connections[0]).toMatchObject({
      fromNodeId: "copy-1",
      toNodeId: "copy-2",
    });
  });

  it("retains live incoming references but drops deleted external sources and duplicate edges", () => {
    const nodes = [node("source"), node("target")];
    const fragment = captureCanvasFragment(
      nodes,
      [edge("one", "source", "target"), edge("two", "source", "target")],
      new Set(["target"]),
    )!;
    const options = {
      offset: { x: 36, y: 36 },
      existingNodes: nodes,
      idFactory: idFactory(),
    };
    expect(placeCanvasFragment(fragment, options).connections).toHaveLength(1);
    expect(
      placeCanvasFragment(fragment, { ...options, existingNodes: [] })
        .connections,
    ).toHaveLength(0);
    expect(placeCanvasFragment(fragment, options).nodes[0].position).toEqual({
      x: 46,
      y: 56,
    });
  });

  it("keeps the original parent only for duplicate-in-place and a still-existing group", () => {
    const nodes = [
      node("group", CanvasNodeType.Group),
      node("child", CanvasNodeType.Text, "group"),
    ];
    const fragment = captureCanvasFragment(nodes, [], new Set(["child"]))!;
    const options = { offset: { x: 36, y: 36 }, existingNodes: nodes };
    expect(
      placeCanvasFragment(fragment, options).nodes[0].metadata?.groupId,
    ).toBeUndefined();
    expect(
      placeCanvasFragment(fragment, {
        ...options,
        preserveExternalGroups: true,
      }).nodes[0].metadata?.groupId,
    ).toBe("group");
    expect(
      placeCanvasFragment(fragment, {
        ...options,
        preserveExternalGroups: true,
        existingNodes: [],
      }).nodes[0].metadata?.groupId,
    ).toBeUndefined();
  });

  it("does not share snapshots across repeated pastes or inherit a running video task", () => {
    const video = node("video", CanvasNodeType.Video);
    video.metadata = {
      content: "",
      status: "loading",
      videoTaskId: "remote-task",
      videoTaskProjectId: "project",
      videoTaskProvider: "platform",
      images: [
        {
          id: "img",
          status: "loading",
          content: "",
          naturalWidth: 0,
          naturalHeight: 0,
          bytes: 0,
          mimeType: "image/png",
        },
      ],
    };
    const fragment = captureCanvasFragment([video], [], new Set([video.id]))!;
    const options = { offset: { x: 0, y: 0 }, existingNodes: [] };
    const first = placeCanvasFragment(fragment, options);
    first.nodes[0].metadata!.images![0].content = "changed";
    const second = placeCanvasFragment(fragment, options);
    expect(second.nodes[0].id).not.toBe(first.nodes[0].id);
    expect(second.nodes[0].metadata).toMatchObject({
      status: "idle",
      images: [{ content: "", status: "idle" }],
    });
    expect(second.nodes[0].metadata?.videoTaskId).toBeUndefined();
    expect(fragment.nodes[0].metadata?.status).toBe("loading");
  });

  it("maps copied composition sources while retaining media and avoids repeated title suffixes", () => {
    const video = node("video", CanvasNodeType.Video);
    const composition = node("composition", "platform:composition");
    composition.title = "Sequence Copy";
    composition.metadata!.composition = {
      version: 1,
      clips: [
        {
          id: "clip",
          sourceNodeId: "video",
          title: "clip",
          url: "/video.mp4",
          startMs: 0,
          endMs: null,
          volume: 1,
        },
      ],
    };
    const fragment = captureCanvasFragment(
      [video, composition],
      [],
      new Set(["video", "composition"]),
    )!;
    const pasted = placeCanvasFragment(fragment, {
      offset: { x: 0, y: 0 },
      existingNodes: [],
      idFactory: idFactory(),
    });
    expect(pasted.nodes[1].metadata?.composition?.clips[0]).toMatchObject({
      sourceNodeId: "copy-1",
      url: "/video.mp4",
    });
    expect(pasted.nodes[1].title).toBe("Sequence Copy");
  });

  it("does nothing for stale or empty selections", () => {
    expect(
      captureCanvasFragment([node("a")], [], new Set(["deleted"])),
    ).toBeNull();
    expect(
      placeCanvasFragment(
        { nodes: [], connections: [] },
        { center: { x: 0, y: 0 }, existingNodes: [] },
      ),
    ).toEqual({ nodes: [], connections: [] });
  });
});
