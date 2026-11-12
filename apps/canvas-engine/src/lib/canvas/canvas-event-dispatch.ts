export type CanvasEventHandler = (payload: unknown) => void;

export type CanvasEventDispatch = {
  emit: (event: string, payload?: unknown) => void;
  on: (event: string, handler: CanvasEventHandler) => () => void;
};

export function createCanvasEventDispatch(
  reportError: (event: string, error: unknown) => void,
): CanvasEventDispatch {
  const handlers = new Map<string, Set<CanvasEventHandler>>();

  return {
    emit(event, payload) {
      const listeners = handlers.get(event);
      if (!listeners?.size) return;

      for (const handler of [...listeners]) {
        if (!listeners.has(handler)) continue;
        try {
          handler(payload);
        } catch (error) {
          reportError(event, error);
        }
      }
    },

    on(event, handler) {
      let listeners = handlers.get(event);
      if (!listeners) {
        listeners = new Set();
        handlers.set(event, listeners);
      }
      listeners.add(handler);

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners?.delete(handler);
        if (listeners?.size === 0) handlers.delete(event);
      };
    },
  };
}
