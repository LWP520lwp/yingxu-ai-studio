import { describe, expect, it, vi } from "vitest";

import { runAtlasGeneration as runNodeGenerationFlow } from "@/atlas-engine/workflows/async-flow";

function flowOptions(overrides: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const options = {
    begin: vi.fn(() => controller),
    prepare: vi.fn(async () => ({ prompt: "ready" })),
    shouldSkip: vi.fn(() => false),
    execute: vi.fn(async () => {}),
    ignoreError: vi.fn(() => false),
    onError: vi.fn(),
    finish: vi.fn(),
    ...overrides,
  };
  return { controller, options };
}

describe("node generation flow", () => {
  it("prepares context, executes the strategy, and always finishes", async () => {
    const { controller, options } = flowOptions();
    const order: string[] = [];
    options.begin = vi.fn(() => {
      order.push("begin");
      return controller;
    });
    options.prepare = vi.fn(async () => {
      order.push("prepare");
      return { prompt: "ready" };
    });
    options.execute = vi.fn(
      async (
        _context: { prompt: string },
        receivedController: AbortController,
      ) => {
        order.push("execute");
        expect(receivedController).toBe(controller);
      },
    );
    options.finish = vi.fn(() => order.push("finish"));

    await expect(runNodeGenerationFlow(options)).resolves.toBe("completed");
    expect(order).toEqual(["begin", "prepare", "execute", "finish"]);
  });

  it("skips an empty strategy input after preparation and still releases it", async () => {
    const { options } = flowOptions({
      shouldSkip: vi.fn((context: { prompt: string }) => !context.prompt),
      prepare: vi.fn(async () => ({ prompt: "" })),
    });

    await expect(runNodeGenerationFlow(options)).resolves.toBe("skipped");
    expect(options.execute).not.toHaveBeenCalled();
    expect(options.finish).toHaveBeenCalledOnce();
  });

  it("treats cancellation and stale request failures as non-errors", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    const { controller, options } = flowOptions({
      execute: vi.fn(async () => {
        controller.abort();
        throw abort;
      }),
      ignoreError: vi.fn((error: unknown) => error === abort),
    });

    await expect(runNodeGenerationFlow(options)).resolves.toBe("cancelled");
    expect(options.onError).not.toHaveBeenCalled();
    expect(options.finish).toHaveBeenCalledOnce();
  });

  it("reports an active request failure and then finalizes it", async () => {
    const failure = new Error("provider unavailable");
    const { options } = flowOptions({
      execute: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(runNodeGenerationFlow(options)).resolves.toBe("failed");
    expect(options.onError).toHaveBeenCalledWith(
      failure,
      expect.any(AbortController),
    );
    expect(options.finish).toHaveBeenCalledOnce();
  });

  it("finalizes when context preparation throws", async () => {
    const failure = new Error("reference could not be loaded");
    const { options } = flowOptions({
      prepare: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(runNodeGenerationFlow(options)).resolves.toBe("failed");
    expect(options.execute).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledWith(
      failure,
      expect.any(AbortController),
    );
    expect(options.finish).toHaveBeenCalledOnce();
  });
});
