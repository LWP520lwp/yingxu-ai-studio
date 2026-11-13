import { describe, expect, it } from "vitest";

import {
  applyAtlasGenerationFailure,
  cancelAtlasGenerationNodes,
  atlasTextBatchOutcome,
  finalizeAtlasImageBatch,
  finalizeAtlasTextBatch,
  patchAtlasTextVariant,
  restoreAtlasCancelledImageSource,
} from "@/atlas-engine/workflows/generation-state";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(
  id: string,
  type: CanvasNodeData["type"],
  metadata: CanvasNodeData["metadata"] = {},
): CanvasNodeData {
  return {
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    metadata,
  };
}

describe("Atlas generation failure commits", () => {
  it("fails only owned outputs and preserves an unmarked image source", () => {
    const source = node("source", CanvasNodeType.Image, {
      status: "success",
      content: "image.png",
    });
    const output = node("output", CanvasNodeType.Video, {
      status: "loading",
      videoTaskId: "task-1",
    });
    const unrelated = node("unrelated", CanvasNodeType.Text, {
      status: "success",
    });

    const result = applyAtlasGenerationFailure([source, output, unrelated], {
      sourceId: source.id,
      pendingOutputIds: [output.id],
      markSource: false,
      details: "provider unavailable",
      clearFailedVideoTask: true,
    });

    expect(result[0]).toBe(source);
    expect(result[1].metadata).toMatchObject({
      status: "error",
      errorDetails: "provider unavailable",
      videoTaskId: undefined,
    });
    expect(result[2]).toBe(unrelated);
  });

  it("marks the source when the workflow owns its generation status", () => {
    const source = node("source", CanvasNodeType.Config, { status: "loading" });
    const result = applyAtlasGenerationFailure([source], {
      sourceId: source.id,
      pendingOutputIds: [],
      markSource: true,
      details: "request rejected",
      clearFailedVideoTask: false,
    });

    expect(result[0].metadata).toMatchObject({
      status: "error",
      errorDetails: "request rejected",
    });
  });
});

describe("Atlas batch result commits", () => {
  it("cancels pending variants while preserving completed siblings and unrelated nodes", () => {
    const pending = node("source", CanvasNodeType.Image, {
      status: "loading",
      images: [
        { id: "done", content: "/done.png", status: "success", naturalWidth: 10, naturalHeight: 10, bytes: 1, mimeType: "image/png" },
        { id: "pending", content: "", status: "loading", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "image/png" },
      ],
    });
    const unrelated = node("other", CanvasNodeType.Text, { status: "loading" });
    const result = cancelAtlasGenerationNodes([pending, unrelated], new Set([pending.id]), "Cancelled");
    expect(result[0].metadata?.status).toBe("idle");
    expect(result[0].metadata?.images?.[0]).toBe(pending.metadata?.images?.[0]);
    expect(result[0].metadata?.images?.[1]).toMatchObject({ status: "error", errorDetails: "Cancelled" });
    expect(result[1]).toBe(unrelated);
  });
  it("streams the primary text into the displayed content without replacing other variants", () => {
    const output = node("output", CanvasNodeType.Text, {
      primaryTextId: "a",
      content: "",
      texts: [
        { id: "a", content: "", status: "loading" },
        { id: "b", content: "other", status: "success" },
      ],
    });
    const result = patchAtlasTextVariant([output], output.id, "a", { content: "streamed" });

    expect(result[0].metadata?.content).toBe("streamed");
    expect(result[0].metadata?.texts).toEqual([
      { id: "a", content: "streamed", status: "loading" },
      { id: "b", content: "other", status: "success" },
    ]);
  });

  it("keeps the selected successful text and removes failed or cancelled variants", () => {
    const results = [
      { id: "first", content: "first result", status: "success" as const },
      { id: "selected", content: "selected result", status: "success" as const },
      { id: "failed", content: "", status: "error" as const },
      null,
    ];
    const outcome = atlasTextBatchOutcome(results);
    const source = node("source", CanvasNodeType.Config, { status: "loading" });
    const output = node("output", CanvasNodeType.Text, { primaryTextId: "selected" });
    const next = finalizeAtlasTextBatch([source, output], {
      sourceId: source.id,
      outputId: output.id,
      configurationSource: true,
      completed: outcome.completed,
      failureDetails: "failed",
    });

    expect(outcome.failed).toHaveLength(1);
    expect(next[0].metadata?.status).toBe("success");
    expect(next[1].metadata).toMatchObject({
      content: "selected result",
      primaryTextId: "selected",
      status: "success",
      texts: outcome.completed,
    });
  });

  it("reports separate source and image-output errors when all images fail", () => {
    const source = node("source", CanvasNodeType.Config);
    const output = node("output", CanvasNodeType.Image);
    const next = finalizeAtlasImageBatch([source, output], {
      sourceId: source.id,
      outputId: output.id,
      configurationSource: true,
      hasSuccess: false,
      failureDetails: "generation failed",
      allFailedDetails: "all images failed",
    });

    expect(next[0].metadata).toMatchObject({ status: "error", errorDetails: "generation failed" });
    expect(next[1].metadata).toMatchObject({ status: "error", errorDetails: "all images failed" });
  });

  it("restores only a still-loading configuration source after image cancellation", () => {
    const pending = node("source", CanvasNodeType.Config, { status: "loading", errorDetails: "old" });
    const finished = node("finished", CanvasNodeType.Config, { status: "success" });
    const next = restoreAtlasCancelledImageSource([pending, finished], pending.id, true);

    expect(next[0].metadata).toMatchObject({ status: "idle", errorDetails: undefined });
    expect(next[1]).toBe(finished);
  });
});
