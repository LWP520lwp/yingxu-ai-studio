import { describe, expect, it } from "vitest";

import {
  applyAtlasNodeOutputPlan,
  atlasNodeOutputConnection,
  atlasNodeOutputId,
  atlasNodeOutputResultIds,
  planAtlasNodeOutput,
} from "@/atlas-engine/workflows/node-output";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function ids() {
  let value = 0;
  return () => `out-${++value}`;
}

function source(): CanvasNodeData {
  return {
    id: "source",
    type: CanvasNodeType.Config,
    title: "Config",
    position: { x: 10, y: 20 },
    width: 340,
    height: 240,
    metadata: {},
  };
}

describe("Atlas node output planning", () => {
  it("produces mode-specific plans through one dispatcher", () => {
    const input = {
      sourceId: "source",
      sourceNode: source(),
      prompt: "A moving light study",
      sourcePrompt: "A moving light study",
      config: defaultConfig,
      overwriteExisting: false,
      imageCount: 2,
      textCount: 3,
      references: [],
      referenceUrls: ["image-reference", "video-reference"],
    };

    const image = planAtlasNodeOutput({ ...input, mode: "image", createId: ids() });
    const video = planAtlasNodeOutput({ ...input, mode: "video", createId: ids() });
    const audio = planAtlasNodeOutput({ ...input, mode: "audio", createId: ids() });
    const text = planAtlasNodeOutput({ ...input, mode: "text", createId: ids() });

    expect(image.mode).toBe("image");
    expect(atlasNodeOutputResultIds(image)).toHaveLength(2);
    expect(video.mode).toBe("video");
    expect(video.output.outputNode.metadata?.references).toEqual(input.referenceUrls);
    expect(audio.mode).toBe("audio");
    expect(text.mode).toBe("text");
    expect(atlasNodeOutputResultIds(text)).toHaveLength(3);
  });

  it("commits the planned node and its connection as one stage", () => {
    const plan = planAtlasNodeOutput({
      mode: "video",
      sourceId: "source",
      sourceNode: source(),
      prompt: "A moving light study",
      sourcePrompt: "A moving light study",
      config: defaultConfig,
      overwriteExisting: false,
      imageCount: 1,
      textCount: 1,
      references: [],
      referenceUrls: [],
      createId: ids(),
    });
    const outputId = atlasNodeOutputId(plan);
    const connection = atlasNodeOutputConnection(plan);
    const result = applyAtlasNodeOutputPlan([source()], plan);

    expect(result.map((node) => node.id)).toEqual(["source", outputId]);
    expect(connection).toMatchObject({ fromNodeId: "source", toNodeId: outputId });
    expect(result[0].metadata?.status).toBe("success");
  });
});
