export type AtlasGenerationRequest = Readonly<{
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  controller: AbortController;
}>;

type ControllerOwner = {
  requests: Set<AtlasGenerationRequest>;
  detachAbort: () => void;
};

export type AtlasGenerationSession = ReturnType<
  typeof createAtlasGenerationSession
>;

/** Tracks active targets separately from the latest writer for each target. */
export function createAtlasGenerationSession() {
  const activeByTarget = new Map<string, AtlasGenerationRequest>();
  const latestWriterByTarget = new Map<string, AbortController>();
  const ownersByController = new Map<AbortController, ControllerOwner>();

  const canWrite = (targetNodeId: string, controller: AbortController) =>
    !controller.signal.aborted &&
    latestWriterByTarget.get(targetNodeId) === controller;

  const detachOwner = (controller: AbortController) => {
    const owner = ownersByController.get(controller);
    if (!owner) return undefined;
    ownersByController.delete(controller);
    owner.detachAbort();
    for (const request of owner.requests) {
      if (activeByTarget.get(request.targetNodeId) === request) {
        activeByTarget.delete(request.targetNodeId);
      }
    }
    return owner;
  };

  const cancelMatching = (
    matches: (request: AtlasGenerationRequest) => boolean,
  ) => {
    const controllers = new Set(
      [...activeByTarget.values()]
        .filter(matches)
        .map((request) => request.controller),
    );
    const affectedNodeIds = new Set<string>();
    for (const controller of controllers) {
      const owner = ownersByController.get(controller);
      for (const request of owner?.requests ?? []) {
        affectedNodeIds.add(request.targetNodeId);
        affectedNodeIds.add(request.originNodeId);
      }
      // Detach before abort so abort callbacks can safely start replacement work.
      detachOwner(controller);
      controller.abort();
    }
    return affectedNodeIds;
  };

  return {
    begin(
      targetNodeId: string,
      originNodeId: string,
      runningNodeId = originNodeId,
      controller = new AbortController(),
    ) {
      const current = activeByTarget.get(targetNodeId);
      if (current?.controller === controller) return controller;
      if (current) {
        cancelMatching((request) => request.controller === current.controller);
      }
      if (controller.signal.aborted) return controller;

      let owner = ownersByController.get(controller);
      if (!owner) {
        const onAbort = () => detachOwner(controller);
        owner = {
          requests: new Set(),
          detachAbort: () =>
            controller.signal.removeEventListener("abort", onAbort),
        };
        ownersByController.set(controller, owner);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      }

      const request: AtlasGenerationRequest = {
        targetNodeId,
        originNodeId,
        runningNodeId,
        controller,
      };
      owner.requests.add(request);
      activeByTarget.set(targetNodeId, request);
      latestWriterByTarget.set(targetNodeId, controller);
      return controller;
    },

    finish(targetNodeId: string, controller: AbortController) {
      const request = activeByTarget.get(targetNodeId);
      if (!request || request.controller !== controller) return false;
      activeByTarget.delete(targetNodeId);
      const owner = ownersByController.get(controller);
      owner?.requests.delete(request);
      if (!owner?.requests.size) detachOwner(controller);
      return true;
    },

    has: (targetNodeId: string) => activeByTarget.has(targetNodeId),

    isCurrent: (targetNodeId: string, controller: AbortController) =>
      !controller.signal.aborted &&
      activeByTarget.get(targetNodeId)?.controller === controller,

    canWrite,

    isLastWriter: (targetNodeId: string, controller: AbortController) =>
      latestWriterByTarget.get(targetNodeId) === controller,

    guard:
      <T>(
        targetNodeId: string,
        controller: AbortController,
        update: (current: T) => T,
      ) =>
      (current: T) =>
        canWrite(targetNodeId, controller) ? update(current) : current,

    cancelRunning: (runningNodeId: string) =>
      cancelMatching((request) => request.runningNodeId === runningNodeId),

    cancelNodes: (nodeIds: ReadonlySet<string>) => {
      const affected = cancelMatching(
        (request) =>
          nodeIds.has(request.targetNodeId) ||
          nodeIds.has(request.originNodeId),
      );
      for (const nodeId of nodeIds) latestWriterByTarget.delete(nodeId);
      return affected;
    },

    cancelAll: () => {
      const affected = cancelMatching(() => true);
      latestWriterByTarget.clear();
      return affected;
    },
  };
}
