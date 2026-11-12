export type DocumentHistory<T> = {
  past: T[];
  present: T;
  future: T[];
  limit: number;
};

export const DOCUMENT_HISTORY_LIMIT = 50;

export function createDocumentHistory<T>(present: T, limit = DOCUMENT_HISTORY_LIMIT): DocumentHistory<T> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("历史记录容量无效");
  return { past: [], present, future: [], limit };
}

export function commitDocument<T>(history: DocumentHistory<T>, next: T): DocumentHistory<T> {
  if (Object.is(history.present, next)) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: next,
    future: [],
  };
}

export function undoDocument<T>(history: DocumentHistory<T>): DocumentHistory<T> {
  if (!history.past.length) return history;
  const present = history.past.at(-1)!;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
  };
}

export function redoDocument<T>(history: DocumentHistory<T>): DocumentHistory<T> {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present,
    future,
  };
}
