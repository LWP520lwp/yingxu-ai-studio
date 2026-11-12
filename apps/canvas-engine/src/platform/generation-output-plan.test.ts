import { describe, expect, it } from "vitest";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import {
  applyCanvasImageBatchFailure,
  applyCanvasImageBatchSuccess,
  applyCanvasImageOutputPlan,
  planCanvasImageOutput,
} from "@/product-engine/generation-output-plan";
import type { ReferenceImage } from "@/types/image";

const imageNode = (overrides: Partial<CanvasNodeData> = {}): CanvasNodeData => ({
  id: "source-image",
  type: CanvasNodeType.Image,
  title: "Source image",
  position: { x: 20, y: 40 },
  width: 420,
  height: 280,
  metadata: {
    content: "data:image/png;base64,source",
    mimeType: "image/png",
    storageKey: "source-key",
  },
  ...overrides,
});

const reference: ReferenceImage = {
  id: "connected-image",
  name: "Connected image",
  type: "image/jpeg",
  dataUrl: "data:image/jpeg;base64,connected",
};

function plan(
  sourceNode: CanvasNodeData | undefined,
  overrides: Partial<Parameters<typeof planCanvasImageOutput>[0]> = {},
) {
  let serial = 0;
  return planCanvasImageOutput({
    sourceId: sourceNode?.id ?? "source",
    sourceNode,
    prompt: "wide mountain lake at sunrise",
    sourcePrompt: "input prompt",
    config: defaultConfig,
    overwriteExisting: false,
    count: 2,
    references: [reference],
    createId: () => `generated-${++serial}`,
    ...overrides,
  });
}

describe("canvas image output plans", () => {
  it("reuses an existing image on overwrite and clears its stale media", () => {
    const source = imageNode();
    const output = plan(source, { overwriteExisting: true });

    expect(output.outputId).toBe(source.id);
    expect(output.reusesSource).toBe(true);
    expect(output.connection).toBeUndefined();
    expect(output.references).toEqual([reference]);

    const [updated] = applyCanvasImageOutputPlan([source], output);
    expect(updated.id).toBe(source.id);
    expect(updated.position).toEqual(source.position);
    expect(updated.metadata).toMatchObject({
      status: "loading",
      prompt: "wide mountain lake at sunrise",
    });
    expect(updated.metadata?.content).toBeUndefined();
    expect(updated.metadata?.storageKey).toBeUndefined();
  });

  it("creates a connected image and uses the untouched source as a reference", () => {
    const source = imageNode();
    const output = plan(source);

    expect(output.outputId).not.toBe(source.id);
    expect(output.generationType).toBe("edit");
    expect(output.references.map(({ id }) => id)).toEqual([
      source.id,
      reference.id,
    ]);
    expect(output.connection).toMatchObject({
      fromNodeId: source.id,
      toNodeId: output.outputId,
    });
    expect(output.outputNode.position).toEqual({ x: 456, y: 40 });

    const next = applyCanvasImageOutputPlan([source], output);
    expect(next[0].metadata?.status).toBe("success");
    expect(next[1]).toEqual(output.outputNode);
  });

  it("marks configuration sources busy and creates loading placeholders", () => {
    const source: CanvasNodeData = {
      id: "config",
      type: CanvasNodeType.Config,
      title: "Config",
      position: { x: 0, y: 0 },
      width: 340,
      height: 240,
      metadata: { generationMode: "image", status: "idle" },
    };
    const output = plan(source, { references: [] });
    const next = applyCanvasImageOutputPlan([source], output);

    expect(next[0].metadata?.status).toBe("loading");
    expect(next[1].type).toBe(CanvasNodeType.Image);
    expect(next[1].metadata?.images?.map(({ id, status }) => [id, status])).toEqual([
      ["generated-2", "loading"],
      ["generated-3", "loading"],
    ]);
    expect(next[1].metadata?.primaryImageId).toBeUndefined();
  });

  it("keeps the source prompt as text when image generation starts from text", () => {
    const source: CanvasNodeData = {
      id: "prompt-node",
      type: CanvasNodeType.Text,
      title: "Draft",
      position: { x: 50, y: 75 },
      width: 260,
      height: 150,
      metadata: { content: "old draft", fontSize: 17 },
    };
    const output = plan(source, { references: [] });
    const next = applyCanvasImageOutputPlan([source], output);

    expect(next[0]).toMatchObject({
      type: CanvasNodeType.Text,
      title: "input prompt",
      width: NODE_DEFAULT_SIZE[CanvasNodeType.Text].width,
      height: NODE_DEFAULT_SIZE[CanvasNodeType.Text].height,
      metadata: {
        content: "input prompt",
        prompt: "input prompt",
        status: "success",
        fontSize: 14,
      },
    });
    expect(next[1].type).toBe(CanvasNodeType.Image);
    expect(output.outputNode.metadata?.prompt).toBe(
      "wide mountain lake at sunrise",
    );
  });

  it("sets the first completed batch image as the primary result and preserves its center", () => {
    const output = plan(undefined, { references: [] });
    const pending: CanvasNodeData = {
      ...output.outputNode,
      position: { x: 400, y: 300 },
      width: 340,
      height: 240,
    };
    const result = {
      id: output.imageIds[0],
      status: "success" as const,
      content: "https://media.example/result.png",
      naturalWidth: 1600,
      naturalHeight: 900,
      bytes: 1200,
      mimeType: "image/png",
    };
    const [first] = applyCanvasImageBatchSuccess([pending], output.outputId, result);

    expect(first.metadata).toMatchObject({
      content: result.content,
      primaryImageId: result.id,
    });
    expect(first.metadata?.images).toContainEqual(result);
    expect(first.position.x + first.width / 2).toBeCloseTo(570);
    expect(first.position.y + first.height / 2).toBeCloseTo(420);

    const other = {
      ...result,
      id: output.imageIds[1],
      content: "https://media.example/second.png",
    };
    const [second] = applyCanvasImageBatchSuccess([first], output.outputId, other);
    expect(second.metadata?.primaryImageId).toBe(result.id);
    expect(second.metadata?.content).toBe(result.content);
    expect(second.metadata?.images).toContainEqual(other);
  });

  it("marks only the failed batch variant and leaves the output node intact", () => {
    const output = plan(undefined, { references: [] });
    const [failed] = applyCanvasImageBatchFailure(
      [output.outputNode],
      output.outputId,
      output.imageIds[1],
      "provider rejected the request",
    );

    expect(failed.metadata?.images?.[0].status).toBe("loading");
    expect(failed.metadata?.images?.[1]).toMatchObject({
      id: output.imageIds[1],
      status: "error",
      errorDetails: "provider rejected the request",
    });
  });
});
