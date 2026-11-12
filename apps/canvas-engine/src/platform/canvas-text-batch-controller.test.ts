import { describe, expect, it, vi } from "vitest";

import { generateCanvasTextBatch } from "@/lib/canvas/canvas-text-batch-controller";
import type { AiConfig } from "@/stores/use-config-store";

const config = { model: "text-model" } as AiConfig;

describe("generateCanvasTextBatch", () => {
  it("streams each item independently and retains successful siblings", async () => {
    const request = vi.fn(async (_config, messages, onDelta, options) => {
      const prompt = String(messages[0]?.content);
      if (prompt.includes("fail")) throw new Error("provider rejected output");
      onDelta(`${prompt} partial`);
      return `${prompt} final`;
    });
    const onStream = vi.fn();
    const onSuccess = vi.fn();
    const onFailure = vi.fn((_id, error) => String(error));
    const results = await generateCanvasTextBatch({
      textIds: ["one", "two"],
      config,
      messages: [{ role: "user", content: "first" }],
      signal: new AbortController().signal,
      ports: { request, isCancelled: () => false },
      onStream,
      onSuccess,
      onFailure,
    });

    expect(results).toEqual([
      { id: "one", status: "success", content: "first final" },
      { id: "two", status: "success", content: "first final" },
    ]);
    expect(onStream).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
    expect(request.mock.calls[0]?.[3]).toEqual({
      signal: expect.any(AbortSignal),
    });
  });

  it("treats aborts as cancellation and reports independent provider failures", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    const request = vi.fn(async (_config, _messages, onDelta) => {
      onDelta("partial");
      throw abort;
    });
    const onFailure = vi.fn((_id, error) => String(error));
    const results = await generateCanvasTextBatch({
      textIds: ["one"],
      config,
      messages: [{ role: "user", content: "prompt" }],
      signal: new AbortController().signal,
      ports: { request, isCancelled: (error) => error === abort },
      onStream: vi.fn(),
      onSuccess: vi.fn(),
      onFailure,
    });

    expect(results).toEqual([null]);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("ignores provider deltas and a final answer delivered after abort", async () => {
    const controller = new AbortController();
    const onStream = vi.fn();
    const onSuccess = vi.fn();
    const onFailure = vi.fn(() => "failed");
    const results = await generateCanvasTextBatch({
      textIds: ["one"],
      config,
      messages: [],
      signal: controller.signal,
      ports: {
        request: vi.fn(async (_config, _messages, onDelta) => {
          controller.abort();
          onDelta("obsolete delta");
          return "obsolete answer";
        }),
        isCancelled: (error) =>
          error instanceof Error && error.name === "AbortError",
      },
      onStream,
      onSuccess,
      onFailure,
    });
    expect(results).toEqual([null]);
    expect(onStream).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });
});
