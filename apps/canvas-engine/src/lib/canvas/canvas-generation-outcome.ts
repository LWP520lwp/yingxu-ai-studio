export type CanvasGenerationOutcome = "success" | "failure" | "cancelled";

export type CanvasGenerationBatchSummary = {
  succeeded: number;
  failed: number;
  cancelled: number;
  hasSuccess: boolean;
  hasFailure: boolean;
  isPartial: boolean;
};

export function summarizeCanvasGenerationBatch(
  outcomes: readonly CanvasGenerationOutcome[],
): CanvasGenerationBatchSummary {
  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;

  for (const outcome of outcomes) {
    if (outcome === "success") succeeded += 1;
    else if (outcome === "failure") failed += 1;
    else cancelled += 1;
  }

  return {
    succeeded,
    failed,
    cancelled,
    hasSuccess: succeeded > 0,
    hasFailure: failed > 0,
    isPartial: succeeded > 0 && failed > 0,
  };
}
