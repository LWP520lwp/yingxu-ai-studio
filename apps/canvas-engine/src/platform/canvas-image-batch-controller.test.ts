import { describe, expect, it, vi } from "vitest";

import { generateCanvasImageBatch } from "@/lib/canvas/canvas-image-batch-controller";
import type { AiConfig } from "@/stores/use-config-store";

const config = { count: "4" } as AiConfig;

describe("generateCanvasImageBatch", () => {
  it("uses edit for reference images and persists each successful result", async () => {
    const edit = vi.fn(async () => [
      { id: "generated", dataUrl: "data:image/png;base64,AA==" },
    ]);
    const generate = vi.fn(async () => [{ id: "unused", dataUrl: "unused" }]);
    const upload = vi.fn(async (data: string | Blob) => ({
      url: `/stored/${String(data).length}.png`,
      storageKey: `key-${String(data).length}`,
      width: 100,
      height: 80,
      bytes: 12,
      mimeType: "image/png",
    }));
    const onImage = vi.fn();
    const references = [
      { id: "ref-1", name: "ref.png", type: "image/png", dataUrl: "data" },
    ];

    const results = await generateCanvasImageBatch({
      imageIds: ["img-1", "img-2"],
      config,
      prompt: "keep the same composition",
      references,
      signal: new AbortController().signal,
      ports: { edit, generate, upload, isCancelled: () => false },
      onImage,
    });

    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledWith(
      { ...config, count: "1" },
      "keep the same composition",
      references,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(generate).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(onImage).toHaveBeenCalledTimes(2);
    expect(results.every(({ outcome }) => outcome === "success")).toBe(true);
  });

  it("keeps sibling successes and reports a failed output without aborting the batch", async () => {
    const edit = vi.fn(async () => []);
    let requestCount = 0;
    const generate = vi.fn(async (_config: AiConfig, prompt: string) => {
      requestCount += 1;
      if (requestCount === 2) throw new Error("provider rejected output");
      return [{ id: "generated", dataUrl: prompt }];
    });
    const upload = vi.fn(async (data: string | Blob) => ({
      url: `/stored/${String(data)}.png`,
      storageKey: String(data),
      width: 100,
      height: 100,
      bytes: 1,
      mimeType: "image/png",
    }));
    const onFailure = vi.fn();
    const onImage = vi.fn();

    const results = await generateCanvasImageBatch({
      imageIds: ["first", "second", "third"],
      config,
      prompt: "generate outputs",
      references: [],
      signal: new AbortController().signal,
      ports: { edit, generate, upload, isCancelled: () => false },
      onImage,
      onFailure,
    });

    expect(results.map(({ outcome }) => outcome)).toEqual([
      "success",
      "failure",
      "success",
    ]);
    expect(onImage).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith("second", expect.any(Error));
  });
});
