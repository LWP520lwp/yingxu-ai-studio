import { describe, expect, it } from "vitest";

import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import {
  applyAtlasImageFailure,
  applyAtlasImageOutputPlan,
  applyAtlasImageSuccess,
  planAtlasImageOutput,
} from "@/atlas-engine/workflows/generation-output";

const reference: ReferenceImage = {
  id: "ref-1",
  name: "Reference",
  type: "image/jpeg",
  dataUrl: "data:image/jpeg;base64,ref",
};

const imageSource = (): CanvasNodeData => ({
  id: "source",
  type: CanvasNodeType.Image,
  title: "Source image",
  position: { x: 20, y: 40 },
  width: 420,
  height: 280,
  metadata: { content: "data:image/png;base64,source", mimeType: "image/png", storageKey: "source-key" },
});

function createPlan(sourceNode?: CanvasNodeData, options: { overwrite?: boolean; refs?: ReferenceImage[]; prompt?: string } = {}) {
  let sequence = 0;
  return planAtlasImageOutput({
    sourceId: sourceNode?.id ?? "empty-source",
    sourceNode,
    prompt: options.prompt ?? "wide mountain lake at sunrise",
    sourcePrompt: "source prompt",
    config: defaultConfig,
    overwriteExisting: options.overwrite ?? false,
    count: 2,
    references: options.refs ?? [reference],
    createId: () => `asset-${++sequence}`,
  });
}

describe("Atlas image output workflow", () => {
  it("plans a nearby generated image with stable unique references", () => {
    const source = imageSource();
    const plan = createPlan(source, { refs: [reference, { ...reference, name: "Last copy" }] });

    expect(plan.generationType).toBe("edit");
    expect(plan.references.map((item) => item.id)).toEqual(["source", "ref-1"]);
    expect(plan.references[1].name).toBe("Last copy");
    expect(plan.outputNode.position).toEqual({ x: 456, y: 40 });
    expect(plan.connection).toMatchObject({ fromNodeId: "source", toNodeId: plan.outputId });
    expect(plan.outputNode.metadata?.images?.every((item) => item.status === "loading")).toBe(true);
  });

  it("reuses a selected image frame on overwrite and discards stale output data", () => {
    const source = imageSource();
    const plan = createPlan(source, { overwrite: true });
    const [updated] = applyAtlasImageOutputPlan([source], plan);

    expect(plan.outputId).toBe(source.id);
    expect(plan.connection).toBeUndefined();
    expect(updated.position).toEqual(source.position);
    expect(updated.metadata?.content).toBeUndefined();
    expect(updated.metadata?.storageKey).toBeUndefined();
    expect(updated.metadata?.status).toBe("loading");
  });

  it("keeps a text prompt node while creating a linked image result", () => {
    const source: CanvasNodeData = {
      id: "prompt",
      type: CanvasNodeType.Text,
      title: "Draft",
      position: { x: 50, y: 75 },
      width: 260,
      height: 150,
      metadata: { content: "draft" },
    };
    const plan = createPlan(source, { refs: [], prompt: "finished image prompt" });
    const updated = applyAtlasImageOutputPlan([source], plan);

    expect(updated[0]).toMatchObject({ type: CanvasNodeType.Text, title: "source prompt", width: 340, height: 240 });
    expect(updated[0].metadata).toMatchObject({ content: "source prompt", prompt: "source prompt", status: "success" });
    expect(updated[1]).toEqual(plan.outputNode);
    expect(plan.outputNode.metadata?.generationType).toBe("generation");
  });

  it("marks a configuration node busy without assigning a primary result early", () => {
    const config: CanvasNodeData = {
      id: "config",
      type: CanvasNodeType.Config,
      title: "Image setup",
      position: { x: 0, y: 0 },
      width: 340,
      height: 240,
      metadata: { generationMode: "image", status: "idle" },
    };
    const plan = createPlan(config, { refs: [] });
    const updated = applyAtlasImageOutputPlan([config], plan);

    expect(updated[0].metadata?.status).toBe("loading");
    expect(updated[1].metadata?.images?.map(({ status }) => status)).toEqual(["loading", "loading"]);
    expect(updated[1].metadata?.primaryImageId).toBeUndefined();
  });

  it("promotes the first successful image while preserving the node center", () => {
    const plan = createPlan(undefined, { refs: [] });
    const pending: CanvasNodeData = { ...plan.outputNode, position: { x: 400, y: 300 }, width: 340, height: 240 };
    const first = {
      id: plan.imageIds[0],
      content: "https://media.example/first.png",
      status: "success" as const,
      naturalWidth: 1600,
      naturalHeight: 900,
      bytes: 1200,
      mimeType: "image/png",
    };
    const [completed] = applyAtlasImageSuccess([pending], plan.outputId, first);

    expect(completed.metadata?.content).toBe(first.content);
    expect(completed.metadata?.primaryImageId).toBe(first.id);
    expect(completed.position.x + completed.width / 2).toBeCloseTo(570);
    expect(completed.position.y + completed.height / 2).toBeCloseTo(420);

    const second = { ...first, id: plan.imageIds[1], content: "https://media.example/second.png" };
    const [withSecond] = applyAtlasImageSuccess([completed], plan.outputId, second);
    expect(withSecond.metadata?.primaryImageId).toBe(first.id);
    expect(withSecond.metadata?.content).toBe(first.content);
    expect(withSecond.metadata?.images).toContainEqual(second);
  });

  it("records a failed variant without changing sibling variants", () => {
    const plan = createPlan(undefined, { refs: [] });
    const [failed] = applyAtlasImageFailure(
      [plan.outputNode],
      plan.outputId,
      plan.imageIds[1],
      "provider rejected the request",
    );

    expect(failed.metadata?.images?.[0].status).toBe("loading");
    expect(failed.metadata?.images?.[1]).toMatchObject({ id: plan.imageIds[1], status: "error", errorDetails: "provider rejected the request" });
  });
});
