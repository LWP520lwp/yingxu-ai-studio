import { describe, expect, it, vi } from "vitest";

import {
  atlasVideoTaskFailureMetadata,
  resumeAtlasVideoTask,
  planAtlasVideoResume,
  applyAtlasVideoResumeFailure,
  type AtlasVideoTaskPorts,
} from "@/atlas-engine/workflows/video-task";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function videoNode(): CanvasNodeData {
  return {
    id: "clip-a",
    type: CanvasNodeType.Video,
    title: "Draft",
    position: { x: 40, y: 60 },
    width: 320,
    height: 180,
    metadata: { status: "loading", videoTaskId: "task-a", prompt: "Keep this prompt" },
  };
}

function makePorts(overrides: Partial<AtlasVideoTaskPorts> = {}) {
  const ports: AtlasVideoTaskPorts = {
    waitForTask: vi.fn(async () => ({ url: "/generated.mp4", mimeType: "video/mp4" })),
    storeVideo: vi.fn(async () => ({
      url: "/assets/generated.mp4",
      storageKey: "asset:video:a",
      bytes: 64,
      mimeType: "video/mp4",
      width: 1280,
      height: 720,
    })),
    ownsNode: vi.fn(() => true),
    updateNode: vi.fn((_nodeId, _controller, update) => update([videoNode()])),
    createCompletedNode: vi.fn((current, media, metadata) => ({
      ...current,
      metadata: { ...current.metadata, ...metadata, content: media.url },
    })),
    ...overrides,
  };
  return ports;
}

const task = { id: "task-a", provider: "platform" as const, model: "video-v1" };

describe("Atlas resumable video tasks", () => {
  it("skips completed or busy tasks and requests configuration only for direct providers", () => {
    const node = videoNode();
    expect(planAtlasVideoResume(node, "video", true, true)).toEqual({ kind: "skip" });
    expect(planAtlasVideoResume({ ...node, metadata: { ...node.metadata, content: "/done.mp4" } }, "video", true, false)).toEqual({ kind: "skip" });
    expect(planAtlasVideoResume(node, "video", false, false)).toEqual({ kind: "configure" });
    expect(planAtlasVideoResume({ ...node, metadata: { ...node.metadata, videoTaskProvider: "platform" } }, "video", false, false)).toMatchObject({ kind: "resume", task: { id: "task-a", provider: "platform", model: "video" } });
  });

  it("does not apply an old polling error to a replacement task", () => {
    const node = videoNode();
    const replaced = { ...node, metadata: { ...node.metadata, videoTaskId: "new-task" } };
    expect(applyAtlasVideoResumeFailure([replaced], node.id, "task-a", "Old error", true)[0]).toBe(replaced);
    expect(applyAtlasVideoResumeFailure([node], node.id, "task-a", "Remote failed", true)[0].metadata).toMatchObject({ status: "error", errorDetails: "Remote failed", videoTaskId: undefined });
  });

  it("stores a completed result and writes it with current prompt settings", async () => {
    const ports = makePorts();
    const controller = new AbortController();
    const config = {
      ...defaultConfig,
      model: "video-v1",
      size: "1280x720",
      videoSeconds: "6",
      vquality: "high",
      videoGenerateAudio: "true",
      videoWatermark: "false",
      videoMode: "image",
    };

    await expect(resumeAtlasVideoTask({
      node: videoNode(), task, config, controller, ports,
    })).resolves.toBe(true);

    expect(ports.waitForTask).toHaveBeenCalledOnce();
    expect(ports.storeVideo).toHaveBeenCalledOnce();
    expect(ports.updateNode).toHaveBeenCalledOnce();
    expect(ports.createCompletedNode).toHaveBeenCalledWith(
      expect.objectContaining({ id: "clip-a" }),
      expect.objectContaining({ url: "/assets/generated.mp4" }),
      {
        prompt: "Keep this prompt",
        model: "video-v1",
        size: "1280x720",
        seconds: "6",
        vquality: "high",
        generateAudio: "true",
        watermark: "false",
        videoMode: "image",
      },
    );
  });

  it("does not store a result when the canvas no longer owns the node task", async () => {
    const ports = makePorts({ ownsNode: vi.fn(() => false) });

    await expect(resumeAtlasVideoTask({
      node: videoNode(), task, config: defaultConfig,
      controller: new AbortController(), ports,
    })).resolves.toBe(false);

    expect(ports.storeVideo).not.toHaveBeenCalled();
    expect(ports.updateNode).not.toHaveBeenCalled();
  });

  it("checks cancellation after polling and before storing media", async () => {
    const controller = new AbortController();
    const ports = makePorts({
      waitForTask: vi.fn(async () => {
        controller.abort();
        return { url: "/late.mp4", mimeType: "video/mp4" };
      }),
    });

    await expect(resumeAtlasVideoTask({
      node: videoNode(), task, config: defaultConfig, controller, ports,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(ports.storeVideo).not.toHaveBeenCalled();
    expect(ports.updateNode).not.toHaveBeenCalled();
  });

  it("leaves a task retryable if local asset storage fails", async () => {
    const ports = makePorts({
      storeVideo: vi.fn(async () => { throw new Error("asset storage unavailable"); }),
    });
    const node = videoNode();

    await expect(resumeAtlasVideoTask({
      node, task, config: defaultConfig,
      controller: new AbortController(), ports,
    })).rejects.toThrow("asset storage unavailable");

    expect(node.metadata?.videoTaskId).toBe("task-a");
    expect(ports.updateNode).not.toHaveBeenCalled();
  });

  it("clears a retry key only for confirmed remote failure and preserves prior media", () => {
    expect(atlasVideoTaskFailureMetadata(
      { status: "loading", content: "/old.mp4", videoTaskId: "task-a" },
      "remote task failed",
      true,
    )).toEqual({
      status: "success",
      content: "/old.mp4",
      videoTaskId: undefined,
      errorDetails: undefined,
    });
    expect(atlasVideoTaskFailureMetadata(
      { status: "loading", videoTaskId: "task-a" },
      "polling unavailable",
      false,
    )).toEqual({
      status: "error",
      videoTaskId: "task-a",
      errorDetails: "polling unavailable",
    });
  });
});
