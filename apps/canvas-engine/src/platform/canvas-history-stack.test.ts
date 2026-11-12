import { describe, expect, it } from "vitest";

import { HISTORY_LIMIT, commitHistory, redoHistory, undoHistory, type HistoryStacks } from "@/lib/canvas/canvas-history-stack";

describe("canvas history stack", () => {
    it("commits undo snapshots, clears redo and keeps a bounded history", () => {
        let stacks: HistoryStacks<number> = { past: [], future: [99] };
        for (let value = 0; value < HISTORY_LIMIT + 7; value += 1) stacks = commitHistory(stacks, value);
        expect(stacks.past).toEqual(Array.from({ length: HISTORY_LIMIT }, (_, index) => index + 7));
        expect(stacks.future).toEqual([]);
    });

    it("undoes and redoes without changing ordering", () => {
        const undone = undoHistory({ past: [1, 2], future: [] }, 3);
        expect(undone).toEqual({ entry: 2, stacks: { past: [1], future: [3] } });
        const redone = redoHistory(undone!.stacks, undone!.entry);
        expect(redone).toEqual({ entry: 3, stacks: { past: [1, 2], future: [] } });
    });

    it("does nothing when the current snapshot or requested history entry is missing", () => {
        expect(undoHistory({ past: [1], future: [] }, null)).toBeNull();
        expect(undoHistory({ past: [], future: [] }, 1)).toBeNull();
        expect(redoHistory({ past: [], future: [] }, 1)).toBeNull();
    });
});
