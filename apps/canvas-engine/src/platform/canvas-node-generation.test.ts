import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from "@/types/canvas";

const harness = vi.hoisted(() => ({
  definitions: new Map<
    string,
    {
      resource?: (
        node: CanvasNodeData,
      ) => {
        kind: "image" | "video" | "audio" | "text";
        url?: string;
        text?: string;
      } | null;
    }
  >(),
}));

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, values?: { index?: number; count?: number }) =>
      key === "imageReferences.label"
        ? `Image ${values?.index}`
        : key === "canvas.composer.resources.text"
          ? `Text ${values?.index}`
          : key === "canvas.references.frameLimit"
            ? `已选 ${values?.count} 张`
            : key,
  },
}));
vi.mock("@/lib/canvas/node-registry", () => ({
  getNodeDefinition: (type: string) => harness.definitions.get(type),
}));
vi.mock("@/services/image-storage", () => ({
  imageToDataUrl: vi.fn(
    async (input: { url?: string }) =>
      input.url || "data:image/png;base64,AA==",
  ),
}));

import {
  buildNodeGenerationContext,
  buildNodeGenerationInputs,
  buildNodeResponseMessages,
  frameReferenceIssue,
  hydrateNodeGenerationContext,
} from "@/components/canvas/canvas-node-generation";
import { createCanvasResourceIndex } from "@/lib/canvas/canvas-resource-references";
import { imageToDataUrl } from "@/services/image-storage";

const node = (
  id: string,
  type: CanvasNodeData["type"],
  metadata: CanvasNodeData["metadata"] = {},
): CanvasNodeData => ({
  id,
  type,
  title: id,
  position: { x: 0, y: 0 },
  width: 240,
  height: 160,
  metadata,
});

const edge = (
  fromNodeId: string,
  toNodeId: string,
  id = `${fromNodeId}-${toNodeId}`,
): CanvasConnection => ({ id, fromNodeId, toNodeId });
const image = (id: string, groupId?: string) =>
  node(id, CanvasNodeType.Image, {
    content: `data:image/png;base64,${id}`,
    mimeType: "image/png",
    groupId,
  });

afterEach(() => harness.definitions.clear());

describe("canvas node generation context", () => {
  it("rebuilds a stale resource index when live node or edge arrays changed", () => {
    const target = node("target", CanvasNodeType.Video);
    const liveNodes = [target, image("frame")];
    const liveConnections = [edge("frame", "target")];
    const staleNodeIndex = createCanvasResourceIndex([target], []);
    const staleConnectionIndex = createCanvasResourceIndex(liveNodes, []);

    const staleNodeContext = buildNodeGenerationContext(
      "target",
      liveNodes,
      liveConnections,
      "pan across the scene",
      { resourceIndex: staleNodeIndex },
    );
    const staleConnectionContext = buildNodeGenerationContext(
      "target",
      liveNodes,
      liveConnections,
      "pan across the scene",
      { resourceIndex: staleConnectionIndex },
    );

    expect(staleNodeContext.referenceImages.map(({ id }) => id)).toEqual([
      "frame",
    ]);
    expect(
      staleConnectionContext.referenceImages.map(({ id }) => id),
    ).toEqual(["frame"]);
  });

  it("propagates reference-read errors and forwards cancellation to image hydration", async () => {
    const nodes = [node("target", CanvasNodeType.Video), image("frame")];
    const context = buildNodeGenerationContext("target", nodes, [edge("frame", "target")], "move");
    const controller = new AbortController();
    const failure = new Error("Reference asset was deleted");
    vi.mocked(imageToDataUrl).mockRejectedValueOnce(failure);
    await expect(hydrateNodeGenerationContext(context, { signal: controller.signal })).rejects.toBe(failure);
    expect(imageToDataUrl).toHaveBeenLastCalledWith(context.referenceImages[0], { signal: controller.signal });
  });

  it("keeps upstream text order and deduplicates direct, nested-group, and plugin references", () => {
    harness.definitions.set("demo:poster", {
      resource: () => ({
        kind: "image",
        url: "https://plugin.example/poster.png",
      }),
    });
    const nodes = [
      node("target", CanvasNodeType.Video),
      node("script-one", CanvasNodeType.Text, { content: "First beat" }),
      node("outer", CanvasNodeType.Group),
      node("inner", CanvasNodeType.Group, { groupId: "outer" }),
      image("frame", "inner"),
      node("poster", "demo:poster", { groupId: "inner" }),
      node("script-two", CanvasNodeType.Text, { prompt: "Second beat" }),
    ];
    const connections = [
      edge("script-one", "target"),
      edge("outer", "target"),
      edge("frame", "target"),
      edge("poster", "target"),
      edge("script-two", "target"),
      edge("frame", "target", "frame-again"),
    ];

    const context = buildNodeGenerationContext(
      "target",
      nodes,
      connections,
      "Create a short scene",
    );
    expect(context.prompt).toBe(
      "Create a short scene\n\n【Text 1】\nFirst beat\n\n【Text 2】\nSecond beat",
    );
    expect(context.referenceImages.map((item) => item.id)).toEqual([
      "frame",
      "poster",
    ]);
    expect(context.textCount).toBe(2);
    expect(context.imageCount).toBe(2);
    expect(
      buildNodeGenerationInputs("target", nodes, connections).map(
        (input) => input.nodeId,
      ),
    ).toEqual(["script-one", "outer", "frame", "poster", "script-two"]);
  });

  it("compiles text and multimodal resource tokens once in prompt order", () => {
    harness.definitions.set("demo:clip", {
      resource: () => ({
        kind: "video",
        url: "https://plugin.example/clip.mp4",
      }),
    });
    const nodes = [
      node("target", CanvasNodeType.Config, {
        composerContent: "compose from selected inputs",
      }),
      node("script", CanvasNodeType.Text, {
        content: "A person enters the room",
      }),
      image("still"),
      node("group", CanvasNodeType.Group),
      node("clip", "demo:clip", { groupId: "group" }),
      node("voice", CanvasNodeType.Audio, {
        content: "https://media.example/voice.wav",
        groupId: "group",
      }),
    ];
    const connections = [
      edge("script", "target"),
      edge("still", "target"),
      edge("group", "target"),
    ];
    const prompt =
      "@[node:script] then @[node:still], include @[node:group], and reuse @[node:still]";

    const context = buildNodeGenerationContext(
      "target",
      nodes,
      connections,
      prompt,
    );
    expect(context.prompt).toBe(
      "【Text 1】 then Image 1, include canvas.configNode.videoReferences 1、canvas.configNode.audioReferences 1, and reuse Image 1\n\n【Text 1】\nA person enters the room",
    );
    expect(context.referenceImages.map((item) => item.id)).toEqual(["still"]);
    expect(context.referenceVideos.map((item) => item.id)).toEqual(["clip"]);
    expect(context.referenceAudios.map((item) => item.id)).toEqual(["voice"]);
    expect(context).toMatchObject({
      textCount: 1,
      imageCount: 1,
      videoCount: 1,
      audioCount: 1,
    });
  });

  it("does not substitute connected images for a missing explicit reference", () => {
    const nodes = [
      node("target", CanvasNodeType.Config, {
        composerContent: "use only selected assets",
      }),
      image("connected"),
    ];
    const context = buildNodeGenerationContext(
      "target",
      nodes,
      [edge("connected", "target")],
      "Animate @[node:deleted-frame]",
    );

    expect(context.referenceImages).toEqual([]);
    expect(context.imageCount).toBe(0);
    expect(context.prompt).toBe("Animate ");
  });

  it("preserves reference-frame order, supports one or two frames, and honors explicit token order", () => {
    const target = node("target", CanvasNodeType.Config, {
      generationMode: "video",
      videoMode: "frames",
      composerContent: "frame motion",
    });
    const nodes = [target, image("first"), image("second"), image("extra")];
    const connections = [
      edge("second", "target"),
      edge("first", "target"),
      edge("extra", "target"),
    ];

    const ordered = buildNodeGenerationContext(
      "target",
      nodes,
      connections,
      "slow pan",
    );
    expect(ordered.referenceImages.map((item) => item.id)).toEqual([
      "second",
      "first",
      "extra",
    ]);
    expect(frameReferenceIssue(ordered.imageCount)).toContain("已选 3 张");

    const explicit = buildNodeGenerationContext(
      "target",
      nodes,
      connections,
      "@[node:first] to @[node:second]",
    );
    expect(explicit.referenceImages.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
    expect(frameReferenceIssue(explicit.imageCount)).toBeUndefined();

    const single = buildNodeGenerationContext(
      "target",
      nodes,
      [edge("first", "target")],
      "slow pan",
    );
    expect(single.referenceImages.map((item) => item.id)).toEqual(["first"]);
    expect(frameReferenceIssue(single.imageCount)).toBeUndefined();
  });

  it("keeps missing frame tokens empty and creates text-plus-image request messages in stable order", () => {
    const target = node("target", CanvasNodeType.Config, {
      generationMode: "video",
      videoMode: "frames",
      composerContent: "frame motion",
    });
    const nodes = [target, image("connected")];
    const context = buildNodeGenerationContext(
      "target",
      nodes,
      [edge("connected", "target")],
      "@[node:removed]",
    );
    expect(context.referenceImages).toEqual([]);

    const messages = buildNodeResponseMessages({
      prompt: "Describe these references",
      referenceImages: [
        {
          id: "one",
          name: "one.png",
          type: "image/png",
          dataUrl: "data:image/png;base64,one",
        },
        {
          id: "two",
          name: "two.png",
          type: "image/png",
          dataUrl: "data:image/png;base64,two",
        },
      ],
      referenceVideos: [],
      referenceAudios: [],
      textCount: 0,
      imageCount: 2,
      videoCount: 0,
      audioCount: 0,
    });
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Describe these references" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,one" },
          },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,two" },
          },
        ],
      },
    ]);
  });
});
