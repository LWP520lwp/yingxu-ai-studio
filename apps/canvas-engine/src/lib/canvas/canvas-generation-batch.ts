import type { CanvasGenerationOutcome } from "@/lib/canvas/canvas-generation-outcome";

export type CanvasGenerationBatchResult<TItem> = {
  item: TItem;
  outcome: CanvasGenerationOutcome;
  error?: unknown;
};

export type CanvasGenerationBatchOptions<TItem> = {
  isCancelled: (error: unknown) => boolean;
  onFailure?: (item: TItem, error: unknown) => void;
};

export async function runCanvasGenerationBatch<TItem>(
  items: readonly TItem[],
  execute: (item: TItem) => Promise<unknown>,
  options: CanvasGenerationBatchOptions<TItem>,
): Promise<CanvasGenerationBatchResult<TItem>[]> {
  return Promise.all(
    items.map(async (item): Promise<CanvasGenerationBatchResult<TItem>> => {
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
