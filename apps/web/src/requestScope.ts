export type ScopedRequest = {
  key: string;
  generation: number;
  controller: AbortController;
  signal: AbortSignal;
};

/** Cancels closed/previous-account work and rejects responses that raced cancellation. */
export class RequestScope {
  private generation = 0;
  private controllers = new Set<AbortController>();

  begin(key: string): ScopedRequest {
    const controller = new AbortController();
    this.controllers.add(controller);
    return {
      key,
      generation: this.generation,
      controller,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    };
  }

  current(request: ScopedRequest, key: string) {
    return (
      request.key === key &&
      request.generation === this.generation &&
      !request.controller.signal.aborted
    );
  }

  release(request: ScopedRequest) {
    this.controllers.delete(request.controller);
  }

  invalidate() {
    this.generation += 1;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}
