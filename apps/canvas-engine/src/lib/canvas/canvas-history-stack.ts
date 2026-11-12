export type HistoryStacks<T> = { past: T[]; future: T[] };
export const HISTORY_LIMIT = 50;

export function commitHistory<T>(stacks: HistoryStacks<T>, previous: T): HistoryStacks<T> {
    return { past: [...stacks.past.slice(-(HISTORY_LIMIT - 1)), previous], future: [] };
}

export function undoHistory<T>(stacks: HistoryStacks<T>, current: T | null) {
    const entry = stacks.past.at(-1);
    if (!entry || current === null) return null;
    return { entry, stacks: { past: stacks.past.slice(0, -1), future: [...stacks.future, current] } };
}

export function redoHistory<T>(stacks: HistoryStacks<T>, current: T | null) {
    const entry = stacks.future.at(-1);
    if (!entry || current === null) return null;
    return { entry, stacks: { past: [...stacks.past, current], future: stacks.future.slice(0, -1) } };
}
