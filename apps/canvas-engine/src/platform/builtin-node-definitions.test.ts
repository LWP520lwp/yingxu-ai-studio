import { describe, expect, it } from "vitest";

import { getNodeSpec, NODE_SPECS } from "@/constant/canvas";
import {
  buildBuiltinNodeDefinitions,
  resourceForNode,
} from "@/atlas-engine/model/builtin-node-definitions";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const icons = Object.fromEntries(
  Object.values(CanvasNodeType).map((type) => [type, type]),
) as Record<CanvasNodeType, string>;

function node(
  type: CanvasNodeType,
  metadata: CanvasNodeData["metadata"] = {},
): CanvasNodeData {
  return {
    id: type,
    type,
    title: type,
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    metadata,
  };
}

describe("built-in node definitions", () => {
  it("builds every platform type in stable order from the canonical specs", () => {
    const definitions = buildBuiltinNodeDefinitions(icons);

    expect(definitions.map(({ type }) => type)).toEqual([
      CanvasNodeType.Text,
      CanvasNodeType.Image,
      CanvasNodeType.Video,
      CanvasNodeType.Audio,
      CanvasNodeType.Config,
      CanvasNodeType.Group,
    ]);
    for (const definition of definitions) {
      const spec = NODE_SPECS[definition.type as CanvasNodeType];
      expect(definition).toMatchObject({
        title: spec.title,
        icon: icons[definition.type as CanvasNodeType],
        defaultSize: { width: spec.width, height: spec.height },
        defaultMetadata: spec.metadata,
      });
      expect(definition.defaultMetadata).not.toBe(spec.metadata);
    }
    expect(
      definitions.find(({ type }) => type === CanvasNodeType.Config)
        ?.hasSourceHandle,
    ).toBe(false);
  });

  it("retains image and video ratio policies and minimap colors", () => {
    const definitions = new Map(
      buildBuiltinNodeDefinitions(icons).map((definition) => [
        definition.type,
        definition,
      ]),
    );
    const image = definitions.get(CanvasNodeType.Image)!;
    const video = definitions.get(CanvasNodeType.Video)!;

    expect(image.minimapColor).toBe("#10b981");
    expect(image.keepAspectRatio?.(node(CanvasNodeType.Image))).toBe(true);
    expect(
      image.keepAspectRatio?.(node(CanvasNodeType.Image, { freeResize: true })),
    ).toBe(false);
    expect(video.minimapColor).toBe("#f97316");
    expect(video.keepAspectRatio?.(node(CanvasNodeType.Video))).toBe(true);
    expect(definitions.get(CanvasNodeType.Audio)?.minimapColor).toBe("#a855f7");
    expect(definitions.get(CanvasNodeType.Config)?.minimapColor).toBe(
      "#60a5fa",
    );
    expect(definitions.get(CanvasNodeType.Group)?.minimapColor).toBe("#94a3b8");
  });

  it("exposes resources only for matching built-in media types with content", () => {
    expect(
      resourceForNode("text", node(CanvasNodeType.Text, { prompt: "Prompt" })),
    ).toEqual({ kind: "text", text: "Prompt" });
    expect(
      resourceForNode("text", node(CanvasNodeType.Text, { content: "Body" })),
    ).toEqual({ kind: "text", text: "Body" });
    expect(
      resourceForNode("image", node(CanvasNodeType.Image, { content: "img" })),
    ).toEqual({ kind: "image", url: "img" });
    expect(
      resourceForNode("video", node(CanvasNodeType.Video, { content: "vid" })),
    ).toEqual({ kind: "video", url: "vid" });
    expect(
      resourceForNode("audio", node(CanvasNodeType.Audio, { content: "aud" })),
    ).toEqual({ kind: "audio", url: "aud" });
    expect(resourceForNode("image", node(CanvasNodeType.Image))).toBeNull();
    expect(
      resourceForNode("image", node(CanvasNodeType.Video, { content: "vid" })),
    ).toBeNull();
    expect(resourceForNode("text", node(CanvasNodeType.Text))).toBeNull();
  });

  it("returns an isolated metadata seed for every node instance", () => {
    const first = getNodeSpec(CanvasNodeType.Text);
    const second = getNodeSpec(CanvasNodeType.Text);
    first.metadata!.content = "changed";
    expect(second.metadata).toMatchObject({ content: "" });
    expect(NODE_SPECS[CanvasNodeType.Text].metadata).toMatchObject({ content: "" });
  });
});
