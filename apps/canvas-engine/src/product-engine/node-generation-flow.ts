export type NodeGenerationFlowOutcome =
  "completed" | "cancelled" | "failed" | "skipped";

export type NodeGenerationFlowOptions<TContext> = {
  begin: () => AbortController;
  prepare: (signal: AbortSignal) => Promise<TContext>;
  shouldSkip?: (context: TContext, signal: AbortSignal) => boolean;
  execute: (context: TContext, controller: AbortController) => Promise<void>;
  ignoreError: (error: unknown, controller: AbortController) => boolean;
  onError: (error: unknown, controller: AbortController) => void;
  finish: (controller: AbortController) => void;
};

export async function runNodeGenerationFlow<TContext>(
  options: NodeGenerationFlowOptions<TContext>,
): Promise<NodeGenerationFlowOutcome> {
  const controller = options.begin();

  try {
    const context = await options.prepare(controller.signal);
    if (controller.signal.aborted) return "cancelled";
    if (options.shouldSkip?.(context, controller.signal)) return "skipped";

    await options.execute(context, controller);
    return controller.signal.aborted ? "cancelled" : "completed";
  } catch (error) {
    if (options.ignoreError(error, controller)) return "cancelled";
    options.onError(error, controller);
    return "failed";
  } finally {
    options.finish(controller);
  }
}
