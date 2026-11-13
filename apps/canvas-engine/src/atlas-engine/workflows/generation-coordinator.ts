import { createAtlasGenerationSession } from "./generation-session";

export type AtlasGenerationScope = Readonly<{ projectId: string; scopeId?: string }>;
export type AtlasGenerationLease = Readonly<{
  controller: AbortController;
  track: (nodeId: string) => AbortController;
  owns: (nodeId: string) => boolean;
  assertCurrent: () => void;
}>;

export type AtlasCoordinatedRun<T> = Readonly<{
  nodeId: string;
  originId?: string;
  runningId?: string;
  prepare: (signal: AbortSignal) => Promise<T>;
  execute: (context: T, lease: AtlasGenerationLease) => Promise<void>;
  skip?: (context: T) => boolean;
  start?: (lease: AtlasGenerationLease) => void;
  failed: (error: unknown, lease: AtlasGenerationLease) => void;
  settled?: (lease: AtlasGenerationLease, latest: boolean) => void;
}>;

function sameScope(left: AtlasGenerationScope, right: AtlasGenerationScope) {
  return left.projectId === right.projectId && left.scopeId === right.scopeId;
}

export function atlasGenerationScopeKey(scope: AtlasGenerationScope, nodeId: string) {
  return JSON.stringify([scope.projectId, scope.scopeId ?? "", nodeId]);
}

/** Owns one request scope and all output targets created by a generation action. */
export function createAtlasGenerationCoordinator(
  readScope: () => AtlasGenerationScope,
  isCancelled: (error: unknown) => boolean = (error) => error instanceof Error && error.name === "AbortError",
) {
  const requests = createAtlasGenerationSession();
  const scopes = new WeakMap<AbortController, AtlasGenerationScope>();
  const inScope = (controller: AbortController) => {
    const scope = scopes.get(controller);
    return scope !== undefined && sameScope(scope, readScope());
  };
  const canWrite = (nodeId: string, controller: AbortController) =>
    inScope(controller) && requests.canWrite(nodeId, controller);
  const begin = (nodeId: string, originId: string, runningId = originId, controller = new AbortController()) => {
    const initial = scopes.get(controller);
    if (initial && !sameScope(initial, readScope())) {
      controller.abort();
      return controller;
    }
    if (!initial) scopes.set(controller, { ...readScope() });
    return requests.begin(nodeId, originId, runningId, controller);
  };

  return {
    ...requests,
    begin,
    canWrite,
    isCurrent: (nodeId: string, controller: AbortController) => inScope(controller) && requests.isCurrent(nodeId, controller),
    isLastWriter: (nodeId: string, controller: AbortController) => inScope(controller) && requests.isLastWriter(nodeId, controller),
    guard: <T>(nodeId: string, controller: AbortController, update: (value: T) => T) =>
      (value: T) => canWrite(nodeId, controller) ? update(value) : value,
    async run<T>(run: AtlasCoordinatedRun<T>): Promise<"completed" | "cancelled" | "failed" | "skipped"> {
      const originId = run.originId ?? run.nodeId;
      const runningId = run.runningId ?? originId;
      const controller = begin(run.nodeId, originId, runningId);
      const targets = new Set([run.nodeId]);
      const lease: AtlasGenerationLease = {
        controller,
        owns: (nodeId) => canWrite(nodeId, controller),
        assertCurrent: () => {
          if (!canWrite(run.nodeId, controller)) throw new DOMException("Generation context has changed", "AbortError");
        },
        track: (nodeId) => {
          lease.assertCurrent();
          targets.add(nodeId);
          return begin(nodeId, originId, runningId, controller);
        },
      };
      try {
        lease.assertCurrent();
        run.start?.(lease);
        lease.assertCurrent();
        const context = await run.prepare(controller.signal);
        lease.assertCurrent();
        if (run.skip?.(context)) return "skipped";
        await run.execute(context, lease);
        return canWrite(run.nodeId, controller) ? "completed" : "cancelled";
      } catch (error) {
        if (isCancelled(error) || !canWrite(run.nodeId, controller)) return "cancelled";
        run.failed(error, lease);
        return "failed";
      } finally {
        for (const nodeId of targets) requests.finish(nodeId, controller);
        run.settled?.(lease, inScope(controller) && requests.isLastWriter(run.nodeId, controller));
      }
    },
  };
}

export type AtlasGenerationCoordinator = ReturnType<typeof createAtlasGenerationCoordinator>;
