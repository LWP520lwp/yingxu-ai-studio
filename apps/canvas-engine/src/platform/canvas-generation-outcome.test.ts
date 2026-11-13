import { describe, expect, it } from "vitest";

import { summarizeAtlasGenerationBatch as summarizeCanvasGenerationBatch } from "@/atlas-engine/workflows/generation-batch";

describe("summarizeCanvasGenerationBatch", () => {
  it("distinguishes full success, partial success, and full failure", () => {
    expect(
      summarizeCanvasGenerationBatch(["success", "success"]),
    ).toMatchObject({
      succeeded: 2,
      failed: 0,
      hasSuccess: true,
      hasFailure: false,
      isPartial: false,
    });
    expect(
      summarizeCanvasGenerationBatch(["success", "failure"]),
    ).toMatchObject({
      succeeded: 1,
      failed: 1,
      hasSuccess: true,
      hasFailure: true,
      isPartial: true,
    });
    expect(
      summarizeCanvasGenerationBatch(["failure", "failure"]),
    ).toMatchObject({
      succeeded: 0,
      failed: 2,
      hasSuccess: false,
      hasFailure: true,
      isPartial: false,
    });
  });

  it("does not report cancellation as a provider failure", () => {
    expect(
      summarizeCanvasGenerationBatch(["success", "cancelled"]),
    ).toMatchObject({
      succeeded: 1,
      failed: 0,
      cancelled: 1,
      hasSuccess: true,
      hasFailure: false,
      isPartial: false,
    });
    expect(summarizeCanvasGenerationBatch(["cancelled"])).toMatchObject({
      succeeded: 0,
      failed: 0,
      cancelled: 1,
      hasSuccess: false,
      hasFailure: false,
      isPartial: false,
    });
  });
});
