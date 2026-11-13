import { describe, expect, it, vi } from "vitest";

import {
  completeAtlasVideoGeneration,
  type AtlasVideoGenerationConfig,
  type AtlasVideoGenerationPorts,
} from "@/atlas-engine/workflows/video-generation";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const config: AtlasVideoGenerationConfig = {
  ...defaultConfig,
  model: "video-model",
  videoSeconds: "5",
  videoGenerateAudio: "false",
  videoWatermark: "false",
  videoMode: "text",
  vquality: "standard",
};

function node(): CanvasNodeData {
  return {
    id: "video-1",
    type: CanvasNodeType.Video,
    title: "Output",
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    metadata: { status: "loading" },
  };
}

function ports(): AtlasVideoGenerationPorts {
  return {
    createTask: vi.fn(async () => ({
      id: "task-1",
      model: "video-model",
      provider: "platform" as const,
    })),
    waitForTask: vi.fn(async () => ({
      url: "https://video.example/result.mp4",
      mimeType: "video/mp4",
    })),
    storeVideo: vi.fn(async () => ({
      url: "/video.mp4",
      storageKey: "video-key",
      width: 1920,
      height: 1080,
      bytes: 42,
      mimeType: "video/mp4",
    })),
    getProjectId: vi.fn(() => "project-1"),
    writeNode: vi.fn((nodeId, _controller, update) => {
      expect(nodeId).toBe("video-1");
      update([node()]);
    }),
    applyVideo: vi.fn((current, video, metadata) => ({
      ...current,
      metadata: { ...current.metadata, ...metadata, content: video.url },
    })),
  };
}

describe("completeAtlasVideoGeneration", () => {
  it("stores the remote task before waiting, then persists the final video", async () => {
    const operations = ports();
    const controller = new AbortController();

    await completeAtlasVideoGeneration({
      ports: operations,
      nodeId: "video-1",
      config,
      prompt: "A moving scene",
      images: [],
      signal: controller.signal,
      controller,
      metadata: { seconds: "5" },
    });

    expect(operations.createTask).toHaveBeenCalledOnce();
    expect(operations.waitForTask).toHaveBeenCalledOnce();
    expect(operations.storeVideo).toHaveBeenCalledOnce();
    expect(operations.writeNode).toHaveBeenCalledTimes(2);
    expect(operations.applyVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: "video-1" }),
      expect.objectContaining({ url: "/video.mp4" }),
      expect.objectContaining({
        prompt: "A moving scene",
        model: "video-model",
        seconds: "5",
      }),
    );
  });

  it("preserves the remote task id when polling or storage fails", async () => {
    const operations = ports();
    vi.mocked(operations.waitForTask).mockRejectedValueOnce(
      new Error("poll failed"),
    );

    await expect(
      completeAtlasVideoGeneration({
        ports: operations,
        nodeId: "video-1",
        config,
        prompt: "A moving scene",
        images: [],
        signal: new AbortController().signal,
        controller: new AbortController(),
      }),
    ).rejects.toThrow("poll failed");

    expect(operations.writeNode).toHaveBeenCalledOnce();
    expect(operations.storeVideo).not.toHaveBeenCalled();
  });

  it("keeps the task record but discards a poll response received after cancellation", async () => {
    const operations = ports();
    const controller = new AbortController();
    vi.mocked(operations.waitForTask).mockImplementationOnce(async () => {
      controller.abort();
      return { url: "/late.mp4", mimeType: "video/mp4" };
    });
    await expect(
      completeAtlasVideoGeneration({
        ports: operations,
        nodeId: "video-1",
        config,
        prompt: "moving scene",
        images: [],
        signal: controller.signal,
        controller,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(operations.writeNode).toHaveBeenCalledOnce();
    expect(operations.storeVideo).not.toHaveBeenCalled();
    expect(operations.applyVideo).not.toHaveBeenCalled();
  });
});
