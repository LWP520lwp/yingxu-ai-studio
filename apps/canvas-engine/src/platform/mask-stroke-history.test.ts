import { describe, expect, it } from "vitest";

import {
  ATLAS_MASK_HISTORY_LIMIT,
  appendAtlasMaskPoint,
  commitAtlasMaskStroke,
  createAtlasMaskStroke,
  redoAtlasMaskStroke,
  undoAtlasMaskStroke,
} from "@/atlas-engine/workflows/mask-strokes";

describe("mask stroke history", () => {
  it("samples subpixel pointer noise while preserving fine paths and endpoints", () => {
    const stroke = createAtlasMaskStroke("paint", 8);
    expect(appendAtlasMaskPoint(stroke, { x: 0, y: 0 })).toBe(true);
    expect(appendAtlasMaskPoint(stroke, { x: 0.2, y: 0.2 })).toBe(false);
    expect(appendAtlasMaskPoint(stroke, { x: 0.5, y: 0 })).toBe(true);
    expect(appendAtlasMaskPoint(stroke, { x: 0.6, y: 0 }, true)).toBe(true);
    expect(appendAtlasMaskPoint(stroke, { x: Number.NaN, y: 4 })).toBe(false);
    expect(stroke.points).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.6, y: 0 },
    ]);
  });

  it("bounds undo history and keeps redo behavior predictable", () => {
    let state = { history: [], redo: [] } as ReturnType<typeof emptyState>;
    for (let index = 0; index < ATLAS_MASK_HISTORY_LIMIT + 1; index += 1) {
      const stroke = createAtlasMaskStroke(index % 2 ? "erase" : "paint", 8);
      appendAtlasMaskPoint(stroke, { x: index, y: 1 });
      const committed = commitAtlasMaskStroke(state, stroke);
      state = { history: committed.history, redo: committed.redo };
      expect(committed.droppedStrokes).toBe(index === ATLAS_MASK_HISTORY_LIMIT ? 1 : 0);
      expect(committed.evictedStrokes).toHaveLength(index === ATLAS_MASK_HISTORY_LIMIT ? 1 : 0);
    }
    expect(state.history).toHaveLength(ATLAS_MASK_HISTORY_LIMIT);
    expect(state.history[0].points[0].x).toBe(1);

    state = undoAtlasMaskStroke(state);
    expect(state.history).toHaveLength(ATLAS_MASK_HISTORY_LIMIT - 1);
    expect(state.redo).toHaveLength(1);
    state = redoAtlasMaskStroke(state);
    expect(state.history).toHaveLength(ATLAS_MASK_HISTORY_LIMIT);
    expect(state.redo).toHaveLength(0);
  });

  it("clears redo after a new stroke and ignores empty commits", () => {
    const first = createAtlasMaskStroke("paint", 8);
    appendAtlasMaskPoint(first, { x: 0, y: 0 });
    const committed = commitAtlasMaskStroke({ history: [], redo: [] }, first);
    const undone = undoAtlasMaskStroke(committed);
    expect(commitAtlasMaskStroke(undone, createAtlasMaskStroke("erase", 8))).toMatchObject({
      history: undone.history,
      redo: undone.redo,
      droppedStrokes: 0,
      evictedStrokes: [],
    });

    const second = createAtlasMaskStroke("erase", 8);
    appendAtlasMaskPoint(second, { x: 1, y: 1 });
    expect(commitAtlasMaskStroke(undone, second).redo).toEqual([]);
  });
});

function emptyState() {
  return { history: [] as ReturnType<typeof createAtlasMaskStroke>[], redo: [] as ReturnType<typeof createAtlasMaskStroke>[] };
}
