export type AtlasGenerationOutcome = "success" | "failure" | "cancelled";

export type AtlasGenerationBatchSummary = Readonly<{
  succeeded: number;
  failed: number;
  cancelled: number;
  hasSuccess: boolean;
  hasFailure: boolean;
  isPartial: boolean;
}>;

export type AtlasGenerationBatchResult<TItem> = {
  item: TItem;
  outcome: AtlasGenerationOutcome;
  error?: unknown;
};

export type AtlasGenerationBatchOptions<TItem> = {
  isCancelled: (error: unknown) => boolean;
  onFailure?: (item: TItem, error: unknown) => void;
};

export async function runAtlasGenerationBatch<TItem>(
  items: readonly TItem[],
  execute: (item: TItem) => Promise<unknown>,
  options: AtlasGenerationBatchOptions<TItem>,
): Promise<AtlasGenerationBatchResult<TItem>[]> {
  return Promise.all(
    items.map(async (item): Promise<AtlasGenerationBatchResult<TItem>> => {
      try {
        await execute(item);
        return { item, outcome: "success" };
      } catch (error) {
        if (options.isCancelled(error)) return { item, outcome: "cancelled" };
        options.onFailure?.(item, error);
        return { item, outcome: "failure", error };
      }
    }),
  );
}

export function summarizeAtlasGenerationBatch(
  outcomes: readonly AtlasGenerationOutcome[],
): AtlasGenerationBatchSummary {
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
