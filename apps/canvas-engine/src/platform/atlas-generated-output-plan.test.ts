import { describe, expect, it } from "vitest";

import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import {
  applyAtlasGeneratedOutputPlan,
  planAtlasGeneratedOutput,
} from "@/atlas-engine/host/workflows/generated-output-plan";

function ids() {
  let sequence = 0;
  return () => `generated-${++sequence}`;
}

function node(
  type: CanvasNodeData["type"],
  patch: Partial<CanvasNodeData> = {},
): CanvasNodeData {
  return {
    id: "source",
    type,
    title: "Source",
    position: { x: 40, y: 80 },
    width: 400,
    height: 200,
    metadata: {},
    ...patch,
  };
}

describe("Atlas generated output planning", () => {
  it("reuses a video node when overwriting and keeps its frame", () => {
    const source = node(CanvasNodeType.Video, {
      width: 512,
      height: 288,
      metadata: { content: "old-video.mp4" },
    });
    const plan = planAtlasGeneratedOutput({
      kind: "video",
      sourceId: source.id,
      sourceNode: source,
      prompt: "new scene",
      config: { ...defaultConfig, size: "16:9" },
      overwriteExisting: true,
      createId: ids(),
    });

    expect(plan.outputId).toBe(source.id);
    expect(plan.connection).toBeUndefined();
    expect(plan.outputNode).toMatchObject({
      position: source.position,
      width: source.width,
      height: source.height,
      metadata: { prompt: "new scene", status: "loading" },
    });
    expect(applyAtlasGeneratedOutputPlan([source], plan)).toHaveLength(1);
  });

  it("places a video beside its source and marks only a config node complete", () => {
    const source = node(CanvasNodeType.Config, { width: 360, height: 400 });
    const plan = planAtlasGeneratedOutput({
      kind: "video",
      sourceId: source.id,
      sourceNode: source,
      prompt: "A moving camera shot",
      config: { ...defaultConfig, size: "16:9" },
      overwriteExisting: false,
      references: ["image-key", "video-key"],
      createId: ids(),
    });
    const result = applyAtlasGeneratedOutputPlan([source], plan);

    expect(plan.outputNode).toMatchObject({
      type: CanvasNodeType.Video,
      position: { x: 496, y: 80 },
      metadata: { references: ["image-key", "video-key"], size: "16:9" },
    });
    expect(plan.connection).toMatchObject({
      fromNodeId: source.id,
      toNodeId: plan.outputId,
    });
    expect(result[0].metadata?.status).toBe("success");
  });

  it("creates bounded text variants and keeps configuration sources busy", () => {
    const source = node(CanvasNodeType.Config, {
      metadata: { textCount: 3, status: "idle" },
    });
    const plan = planAtlasGeneratedOutput({
      kind: "text",
      sourceId: source.id,
      sourceNode: source,
      prompt: "Write three options",
      config: defaultConfig,
      overwriteExisting: false,
      textCount: 3,
      createId: ids(),
    });
    const result = applyAtlasGeneratedOutputPlan([source], plan);

    expect(plan.resultIds).toEqual([
      "generated-2",
      "generated-3",
      "generated-4",
    ]);
    expect(plan.outputNode.metadata).toMatchObject({
      textCount: 3,
      primaryTextId: "generated-2",
      texts: [
        { id: "generated-2", content: "", status: "loading" },
        { id: "generated-3", content: "", status: "loading" },
        { id: "generated-4", content: "", status: "loading" },
      ],
    });
    expect(result[0].metadata?.status).toBe("loading");
    expect(result[1]).toEqual(plan.outputNode);
  });

  it("reuses empty audio and initializes generated audio settings", () => {
    const source = node(CanvasNodeType.Audio, {
      metadata: { content: "", audioVoice: "old" },
    });
    const plan = planAtlasGeneratedOutput({
      kind: "audio",
      sourceId: source.id,
      sourceNode: source,
      prompt: "Speak clearly",
      config: { ...defaultConfig, audioVoice: "alloy" },
      overwriteExisting: false,
      createId: ids(),
    });

    expect(plan.outputId).toBe(source.id);
    expect(plan.outputNode.metadata).toMatchObject({
      prompt: "Speak clearly",
      status: "loading",
      audioVoice: "alloy",
    });
    expect(plan.connection).toBeUndefined();
  });
});
