import { describe, expect, it, vi } from "vitest";

import {
  resumeCanvasVideoTask,
  videoTaskFailureMetadata,
  type ResumeVideoTaskPorts,
} from "@/product-engine/resume-video-task";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(): CanvasNodeData {
  return {
    id: "video-1",
    type: CanvasNodeType.Video,
    title: "Draft",
    position: { x: 40, y: 60 },
    width: 320,
    height: 180,
    metadata: { status: "loading", videoTaskId: "task-1", prompt: "Keep prompt" },
  };
}

function ports(overrides: Partial<ResumeVideoTaskPorts> = {}) {
  const operations: ResumeVideoTaskPorts = {
    waitForTask: vi.fn(async () => ({ url: "/result.mp4", mimeType: "video/mp4" })),
    storeVideo: vi.fn(async () => ({
      url: "/stored.mp4",
      storageKey: "video:1",
      bytes: 32,
      mimeType: "video/mp4",
      width: 1280,
      height: 720,
    })),
    canWrite: vi.fn(() => true),
    writeNode: vi.fn((nodeId, _controller, update) => {
      expect(nodeId).toBe("video-1");
      update([node()]);
    }),
    applyVideo: vi.fn((current, video, metadata) => ({
      ...current,
      metadata: { ...current.metadata, ...metadata, content: video.url },
    })),
    ...overrides,
  };
  return operations;
}

describe("resumable canvas video task", () => {
  it("waits, stores, then applies the result with current node metadata", async () => {
    const operations = ports();
    const controller = new AbortController();
    const config = {
      ...defaultConfig,
      model: "video-model",
      size: "1280x720",
      videoSeconds: "6",
      vquality: "high",
      videoGenerateAudio: "true",
      videoWatermark: "false",
      videoMode: "image",
    };

    await expect(
      resumeCanvasVideoTask({
        node: node(),
        task: {
          id: "task-1",
          provider: "openai",
          model: "video-model",
          projectId: "project-1",
        },
        config,
        controller,
        ports: operations,
      }),
    ).resolves.toBe(true);

    expect(operations.waitForTask).toHaveBeenCalledOnce();
    expect(operations.storeVideo).toHaveBeenCalledOnce();
    expect(operations.writeNode).toHaveBeenCalledOnce();
    expect(operations.applyVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: "video-1" }),
      expect.objectContaining({ url: "/stored.mp4" }),
      {
        prompt: "Keep prompt",
        model: "video-model",
        size: "1280x720",
        seconds: "6",
        vquality: "high",
        generateAudio: "true",
        watermark: "false",
        videoMode: "image",
      },
    );
  });

  it("does not store or write a result after the request loses node ownership", async () => {
    const operations = ports({ canWrite: vi.fn(() => false) });
    const controller = new AbortController();

    await expect(
      resumeCanvasVideoTask({
        node: node(),
        task: { id: "task-1", provider: "platform", model: "video-model" },
        config: defaultConfig,
        controller,
        ports: operations,
      }),
    ).resolves.toBe(false);

    expect(operations.storeVideo).not.toHaveBeenCalled();
    expect(operations.writeNode).not.toHaveBeenCalled();
  });

  it("stops before storage when cancellation arrives with the poll response", async () => {
    const controller = new AbortController();
    const operations = ports({
      waitForTask: vi.fn(async () => {
        controller.abort();
        return { url: "/late.mp4", mimeType: "video/mp4" };
      }),
    });

    await expect(
      resumeCanvasVideoTask({
        node: node(),
        task: { id: "task-1", provider: "platform", model: "video-model" },
        config: defaultConfig,
        controller,
        ports: operations,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(operations.storeVideo).not.toHaveBeenCalled();
    expect(operations.writeNode).not.toHaveBeenCalled();
  });

  it("leaves task persistence to the caller and rejects storage failures", async () => {
    const operations = ports({
      storeVideo: vi.fn(async () => {
        throw new Error("asset storage unavailable");
      }),
    });
    const controller = new AbortController();
    const current = node();

    await expect(
      resumeCanvasVideoTask({
        node: current,
        task: { id: "task-1", provider: "platform", model: "video-model" },
        config: defaultConfig,
        controller,
        ports: operations,
      }),
    ).rejects.toThrow("asset storage unavailable");

    expect(current.metadata?.videoTaskId).toBe("task-1");
    expect(operations.writeNode).not.toHaveBeenCalled();
  });
});

describe("resumed video task failure metadata", () => {
  it("keeps a retryable task id for poll or asset-storage failures", () => {
    expect(
      videoTaskFailureMetadata(
        { status: "loading", videoTaskId: "task-1" },
        "asset storage unavailable",
        false,
      ),
    ).toEqual({
      status: "error",
      errorDetails: "asset storage unavailable",
      videoTaskId: "task-1",
    });
  });

  it("clears only a confirmed failed remote task and preserves existing media", () => {
    expect(
      videoTaskFailureMetadata(
        {
          status: "loading",
          content: "/previous.mp4",
          videoTaskId: "task-1",
        },
        "remote task failed",
        true,
      ),
    ).toEqual({
      status: "success",
      content: "/previous.mp4",
      videoTaskId: undefined,
      errorDetails: undefined,
    });
  });
});
