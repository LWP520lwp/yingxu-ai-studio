export type AtlasHistory<T> = Readonly<{
  past: readonly T[];
  present: T;
  future: readonly T[];
  capacity: number;
}>;

export const ATLAS_HISTORY_CAPACITY = 50;

export function createAtlasHistory<T>(
  present: T,
  capacity = ATLAS_HISTORY_CAPACITY,
): AtlasHistory<T> {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("历史记录容量必须是正整数");
  }
  return { past: [], present, future: [], capacity };
}

export function recordAtlasSnapshot<T>(
  history: AtlasHistory<T>,
  next: T,
): AtlasHistory<T> {
  if (Object.is(history.present, next)) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.capacity),
    present: next,
    future: [],
  };
}

export function undoAtlasHistory<T>(history: AtlasHistory<T>): AtlasHistory<T> {
  if (history.past.length === 0) return history;
  const present = history.past[history.past.length - 1]!;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
  };
}

export function redoAtlasHistory<T>(history: AtlasHistory<T>): AtlasHistory<T> {
  if (history.future.length === 0) return history;
  const [present, ...future] = history.future;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.capacity),
    present,
    future,
  };
}
