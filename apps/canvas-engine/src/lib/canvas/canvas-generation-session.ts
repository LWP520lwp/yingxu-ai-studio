type GenerationRequest = {
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  controller: AbortController;
};

/** One controller can own a source and several output nodes in a batch. */
export function createCanvasGenerationSession() {
  const targets = new Map<string, GenerationRequest>();
  // Keep the last writer after finish: React may apply a queued update later.
  const writers = new Map<string, AbortController>();
  const owners = new Map<
    AbortController,
    { requests: Set<GenerationRequest>; detach: () => void }
  >();
  const canWrite = (targetNodeId: string, controller: AbortController) =>
    !controller.signal.aborted && writers.get(targetNodeId) === controller;

  function release(controller: AbortController) {
    const owner = owners.get(controller);
    if (!owner) return;
    owners.delete(controller);
    owner.detach();
    for (const request of owner.requests) {
      if (targets.get(request.targetNodeId) === request)
        targets.delete(request.targetNodeId);
    }
  }

  function cancel(
    predicate: (request: GenerationRequest) => boolean,
  ): Set<string> {
    const controllers = new Set(
      [...targets.values()]
        .filter(predicate)
        .map((request) => request.controller),
    );
    const affected = new Set<string>();
    for (const controller of controllers) {
      for (const request of owners.get(controller)?.requests || []) {
        affected.add(request.targetNodeId);
        affected.add(request.originNodeId);
      }
      // Detach before abort: event handlers may synchronously start replacement work.
      release(controller);
      controller.abort();
    }
    return affected;
  }

  return {
    begin(
      targetNodeId: string,
      originNodeId: string,
      runningNodeId = originNodeId,
      controller = new AbortController(),
    ) {
      const previous = targets.get(targetNodeId);
      if (previous?.controller === controller) return controller;
      if (previous)
        cancel((request) => request.controller === previous.controller);
      if (controller.signal.aborted) return controller;
      let owner = owners.get(controller);
      if (!owner) {
        const aborted = () => release(controller);
        owner = {
          requests: new Set(),
          detach: () => controller.signal.removeEventListener("abort", aborted),
        };
        owners.set(controller, owner);
        controller.signal.addEventListener("abort", aborted, { once: true });
      }
      const request = { targetNodeId, originNodeId, runningNodeId, controller };
      owner.requests.add(request);
      targets.set(targetNodeId, request);
      writers.set(targetNodeId, controller);
      return controller;
    },
    finish(targetNodeId: string, controller: AbortController): boolean {
      const request = targets.get(targetNodeId);
      if (!request || request.controller !== controller) return false;
      targets.delete(targetNodeId);
      const owner = owners.get(controller);
      owner?.requests.delete(request);
      if (!owner?.requests.size) release(controller);
      return true;
    },
    has: (targetNodeId: string) => targets.has(targetNodeId),
    isCurrent: (targetNodeId: string, controller: AbortController) =>
      !controller.signal.aborted &&
      targets.get(targetNodeId)?.controller === controller,
    canWrite,
    isLastWriter: (targetNodeId: string, controller: AbortController) =>
      writers.get(targetNodeId) === controller,
    guard:
      <T>(
        targetNodeId: string,
        controller: AbortController,
        update: (current: T) => T,
      ) =>
      (current: T) =>
        canWrite(targetNodeId, controller) ? update(current) : current,
    cancelRunning: (runningNodeId: string) =>
      cancel((request) => request.runningNodeId === runningNodeId),
    cancelNodes: (nodeIds: ReadonlySet<string>) => {
      const affected = cancel(
        (request) =>
          nodeIds.has(request.targetNodeId) ||
          nodeIds.has(request.originNodeId),
      );
      for (const id of nodeIds) writers.delete(id);
      return affected;
    },
    cancelAll: () => {
      const affected = cancel(() => true);
      writers.clear();
      return affected;
    },
  };
}
