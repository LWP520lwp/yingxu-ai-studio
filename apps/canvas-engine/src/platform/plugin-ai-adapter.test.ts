import { afterEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  requestEdit: vi.fn(),
  requestGeneration: vi.fn(),
  requestImageQuestion: vi.fn(),
  requestVideoGeneration: vi.fn(),
  storeGeneratedVideo: vi.fn(),
  imageToDataUrl: vi.fn(),
}));

vi.mock("@/services/api/image", () => ({
  requestEdit: ports.requestEdit,
  requestGeneration: ports.requestGeneration,
  requestImageQuestion: ports.requestImageQuestion,
}));
vi.mock("@/services/api/video", () => ({
  requestVideoGeneration: ports.requestVideoGeneration,
  storeGeneratedVideo: ports.storeGeneratedVideo,
}));
vi.mock("@/services/image-storage", () => ({
  imageToDataUrl: ports.imageToDataUrl,
}));

import { createAtlasPluginGeneration } from "@/atlas-engine/plugins/generation-adapter";
import { defaultConfig } from "@/stores/use-config-store";

afterEach(() => {
  vi.clearAllMocks();
});

function createAdapter() {
  const ensureReady = vi.fn();
  return {
    ai: createAtlasPluginGeneration(defaultConfig, ensureReady),
    ensureReady,
  };
}

describe("canvas plugin AI adapter", () => {
  it("selects edit for references and forwards image options and cancellation", async () => {
    const signal = new AbortController().signal;
    ports.requestEdit.mockResolvedValue([
      { dataUrl: "data:image/png;base64,a" },
    ]);
    ports.imageToDataUrl.mockResolvedValue("data:image/png;base64,normalized");
    const { ai, ensureReady } = createAdapter();

    await expect(
      ai.generateImage("paint a bird", {
        count: 3,
        size: "16:9",
        model: "studio::image-v2",
        references: [
          "https://example.test/ref.png",
          "",
          "data:image/png;base64,b",
        ],
        signal,
      }),
    ).resolves.toEqual({ images: ["data:image/png;base64,normalized"] });

    expect(ensureReady).toHaveBeenCalledOnce();
    expect(ensureReady.mock.calls[0][0]).toMatchObject({
      model: "studio::image-v2",
      count: "3",
      size: "16:9",
    });
    expect(ports.requestEdit).toHaveBeenCalledOnce();
    expect(ports.requestGeneration).not.toHaveBeenCalled();
    expect(ports.requestEdit.mock.calls[0]).toMatchObject([
      expect.objectContaining({ model: "studio::image-v2", count: "3" }),
      "paint a bird",
      [
        {
          id: "plugin-ref-0",
          name: "ref-0.png",
          type: "image/png",
          dataUrl: "https://example.test/ref.png",
        },
        {
          id: "plugin-ref-1",
          name: "ref-1.png",
          type: "image/png",
          dataUrl: "data:image/png;base64,b",
        },
      ],
      { signal },
    ]);
    expect(ports.imageToDataUrl).toHaveBeenCalledWith(
      { dataUrl: "data:image/png;base64,a" },
      { signal },
    );
  });

  it("uses text-to-image when references are absent and keeps source data on conversion failure", async () => {
    ports.requestGeneration.mockResolvedValue([
      { dataUrl: "data:image/png;base64,raw" },
    ]);
    ports.imageToDataUrl.mockRejectedValue(new Error("decode failed"));
    const { ai } = createAdapter();

    await expect(
      ai.generateImage("a quiet lake", { count: 0 }),
    ).resolves.toEqual({
      images: ["data:image/png;base64,raw"],
    });
    expect(ports.requestGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ count: "1" }),
      "a quiet lake",
      { signal: undefined },
    );
    expect(ports.requestEdit).not.toHaveBeenCalled();
  });

  it("does not hide an image conversion error after the caller aborts", async () => {
    ports.requestGeneration.mockResolvedValue([
      { dataUrl: "data:image/png;base64,raw" },
    ]);
    const controller = new AbortController();
    ports.imageToDataUrl.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const { ai } = createAdapter();

    await expect(
      ai.generateImage("a quiet lake", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stores generated video and returns the plugin-facing media shape", async () => {
    const signal = new AbortController().signal;
    ports.requestVideoGeneration.mockResolvedValue({
      url: "/api/assets/video/content",
      mimeType: "video/mp4",
    });
    ports.storeGeneratedVideo.mockResolvedValue({
      url: "/api/assets/video/content",
      storageKey: "video:key",
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
      durationMs: 6000,
    });
    const { ai } = createAdapter();

    await expect(
      ai.generateVideo("a paper plane", {
        model: "studio::video-v2",
        size: "1920x1080",
        seconds: "8",
        references: ["data:image/png;base64,ref"],
        signal,
      }),
    ).resolves.toEqual({
      url: "/api/assets/video/content",
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
      durationMs: 6000,
    });
    expect(ports.requestVideoGeneration.mock.calls[0]).toMatchObject([
      expect.objectContaining({
        model: "studio::video-v2",
        size: "1920x1080",
        videoSeconds: "8",
      }),
      "a paper plane",
      [{ id: "plugin-ref-0", dataUrl: "data:image/png;base64,ref" }],
      { signal },
    ]);
    expect(ports.storeGeneratedVideo).toHaveBeenCalledWith({
      url: "/api/assets/video/content",
      mimeType: "video/mp4",
    });
  });

  it("passes system messages, streaming deltas and abort signal to text generation", async () => {
    const signal = new AbortController().signal;
    ports.requestImageQuestion.mockImplementation(
      async (_config, messages, onDelta, _options) => {
        onDelta("Hello");
        return messages
          .map((message: { content: string }) => message.content)
          .join(" ");
      },
    );
    const onDelta = vi.fn();
    const { ai } = createAdapter();

    await expect(
      ai.generateText("Summarize this image", {
        model: "studio::text-v2",
        system: "Be concise.",
        onDelta,
        signal,
      }),
    ).resolves.toEqual({ text: "Be concise. Summarize this image" });
    expect(onDelta).toHaveBeenCalledWith("Hello");
    expect(ports.requestImageQuestion.mock.calls[0]).toMatchObject([
      expect.objectContaining({ model: "studio::text-v2" }),
      [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Summarize this image" },
      ],
      expect.any(Function),
      { signal },
    ]);
  });

  it("exposes configured model ids and channel-free display labels", () => {
    const config = {
      ...defaultConfig,
      channels: [
        {
          id: "studio",
          name: "Studio",
          baseUrl: "https://api.example.test",
          apiKey: "key",
          apiFormat: "openai" as const,
          models: [
            { name: "image-v2", capability: "image" as const },
            { name: "text-v2", capability: "text" as const },
          ],
        },
      ],
      models: ["studio::image-v2", "studio::text-v2"],
      textModel: "studio::text-v2",
    };
    const ai = createAtlasPluginGeneration(config, () => {});

    expect(ai.listModels("image")).toEqual([
      { value: "studio::image-v2", label: "image-v2" },
    ]);
    expect(ai.defaultModel("text")).toBe("studio::text-v2");
  });
});
