import { describe, expect, it, vi } from "vitest";

import { runAtlasGenerationBatch } from "@/atlas-engine/workflows/generation-batch";

describe("Atlas generation batch", () => {
  it("runs independent outputs concurrently and retains partial successes", async () => {
    const started: number[] = [];
    const fail = new Error("provider failed");
    const onFailure = vi.fn();
    const resultsPromise = runAtlasGenerationBatch(
      [1, 2, 3],
      async (item) => {
        started.push(item);
        if (item === 2) throw fail;
      },
      { isCancelled: () => false, onFailure },
    );

    expect(started).toEqual([1, 2, 3]);
    const results = await resultsPromise;
    expect(results.map(({ outcome }) => outcome)).toEqual([
      "success",
      "failure",
      "success",
    ]);
    expect(results[1]).toMatchObject({
      item: 2,
      outcome: "failure",
      error: fail,
    });
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(2, fail);
  });

  it("classifies aborts separately and continues other outputs", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    const onFailure = vi.fn();
    const results = await runAtlasGenerationBatch(
      ["cancel", "error", "ok"],
      async (item) => {
        if (item === "cancel") throw abort;
        if (item === "error") throw new Error("bad request");
      },
      {
        isCancelled: (error) => error === abort,
        onFailure,
      },
    );

    expect(results.map(({ outcome }) => outcome)).toEqual([
      "cancelled",
      "failure",
      "success",
    ]);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(
      "error",
      expect.any(Error),
    );
  });
});
