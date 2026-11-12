import { describe, expect, it } from "vitest";

import {
  createSplitEditorState,
  reduceSplitEditorState,
  splitEditorCounts,
  SPLIT_EDITOR_HISTORY_LIMIT,
} from "@/lib/canvas/canvas-split-editor";

describe("canvas split editor state", () => {
  it("updates grid counts and restores exact parameters through undo and redo", () => {
    const initial = createSplitEditorState();
    const changed = reduceSplitEditorState(initial, {
      type: "set-count",
      axis: "horizontal",
      value: 4,
    });

    expect(changed.params).toEqual({
      rows: 4,
      columns: 2,
      horizontalLines: [0.25, 0.5, 0.75],
      verticalLines: [0.5],
    });
    expect(reduceSplitEditorState(changed, { type: "undo" }).params).toEqual(
      initial.params,
    );
    expect(
      reduceSplitEditorState(
        reduceSplitEditorState(changed, { type: "undo" }),
        { type: "redo" },
      ).params,
    ).toEqual(changed.params);
  });

  it("adds a cut in the widest gap, selects it and removes it as one undoable edit", () => {
    const initial = createSplitEditorState();
    const added = reduceSplitEditorState(initial, {
      type: "add-line",
      axis: "horizontal",
    });
    expect(added.params.horizontalLines).toEqual([0.25, 0.5]);
    expect(added.params.rows).toBe(3);
    expect(added.active).toEqual({ axis: "horizontal", index: 0 });

    const removed = reduceSplitEditorState(added, { type: "delete-active" });
    expect(removed.params.horizontalLines).toEqual([0.5]);
    expect(removed.params.rows).toBe(2);
    expect(removed.active).toBeNull();
    expect(reduceSplitEditorState(removed, { type: "undo" }).params).toEqual(
      added.params,
    );
  });

  it("keeps cuts ordered and inside the canvas while dragging", () => {
    const state = {
      ...createSplitEditorState(),
      params: {
        rows: 3,
        columns: 2,
        horizontalLines: [0.5, 0.505],
        verticalLines: [0.5],
      },
    };
    const moved = reduceSplitEditorState(state, {
      type: "move-line",
      axis: "horizontal",
      index: 0,
      value: 10,
    });
    expect(moved.params.horizontalLines?.[0]).toBeLessThan(
      moved.params.horizontalLines?.[1] ?? 0,
    );
    expect(moved.params.horizontalLines?.[0]).toBeLessThan(1);

    const movedBack = reduceSplitEditorState(moved, {
      type: "move-line",
      axis: "horizontal",
      index: 0,
      value: -10,
    });
    expect(movedBack.params.horizontalLines?.[0]).toBeGreaterThan(0);
    expect(movedBack.params.horizontalLines?.[0]).toBeLessThan(
      movedBack.params.horizontalLines?.[1] ?? 0,
    );
  });

  it("records a single undo point for an entire drag and drops stale redo after edits", () => {
    const initial = createSplitEditorState();
    const started = reduceSplitEditorState(initial, {
      type: "select-line",
      axis: "vertical",
      index: 0,
      record: true,
    });
    const dragged = reduceSplitEditorState(started, {
      type: "move-line",
      axis: "vertical",
      index: 0,
      value: 0.7,
    });
    expect(dragged.history).toHaveLength(1);
    expect(reduceSplitEditorState(dragged, { type: "undo" }).params).toEqual(
      initial.params,
    );

    const undone = reduceSplitEditorState(dragged, { type: "undo" });
    const edited = reduceSplitEditorState(undone, {
      type: "set-count",
      axis: "vertical",
      value: 3,
    });
    expect(edited.redo).toHaveLength(0);
  });

  it("resets lines to an even grid and keeps history bounded", () => {
    let state = reduceSplitEditorState(createSplitEditorState(), {
      type: "set-count",
      axis: "vertical",
      value: 5,
    });
    state = reduceSplitEditorState(state, {
      type: "move-line",
      axis: "vertical",
      index: 0,
      value: 0.1,
    });
    state = reduceSplitEditorState(state, { type: "reset-lines" });
    expect(state.params.verticalLines).toEqual([0.2, 0.4, 0.6, 0.8]);

    for (let index = 0; index < 60; index += 1) {
      state = reduceSplitEditorState(state, {
        type: "set-count",
        axis: "horizontal",
        value: index % 2 ? 2 : 3,
      });
    }
    expect(state.history).toHaveLength(SPLIT_EDITOR_HISTORY_LIMIT);
  });

  it("derives displayed counts from the effective cut arrays", () => {
    expect(
      splitEditorCounts({
        rows: 8,
        columns: 9,
        horizontalLines: [0.4],
        verticalLines: [0.3, 0.6],
      }),
    ).toEqual({
      rows: 2,
      columns: 3,
      horizontalLines: [0.4],
      verticalLines: [0.3, 0.6],
    });
  });
});
