import { describe, expect, it } from "vitest";

import {
  MAX_MASK_HISTORY_STROKES,
  appendMaskStrokePoint,
  commitMaskStroke,
  createMaskStroke,
  redoMaskStroke,
  undoMaskStroke,
} from "@/lib/canvas/mask-stroke-history";

describe("mask stroke history", () => {
  it("samples subpixel pointer noise while preserving fine paths and endpoints", () => {
    const stroke = createMaskStroke("paint", 8);
    expect(appendMaskStrokePoint(stroke, { x: 0, y: 0 })).toBe(true);
    expect(appendMaskStrokePoint(stroke, { x: 0.2, y: 0.2 })).toBe(false);
    expect(appendMaskStrokePoint(stroke, { x: 0.5, y: 0 })).toBe(true);
    expect(appendMaskStrokePoint(stroke, { x: 0.6, y: 0 }, true)).toBe(true);
    expect(appendMaskStrokePoint(stroke, { x: Number.NaN, y: 4 })).toBe(false);
    expect(stroke.points).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.6, y: 0 },
    ]);
  });

  it("bounds undo history and keeps redo behavior predictable", () => {
    let state = { history: [], redo: [] } as ReturnType<typeof emptyState>;
    for (let index = 0; index < MAX_MASK_HISTORY_STROKES + 1; index += 1) {
      const stroke = createMaskStroke(index % 2 ? "erase" : "paint", 8);
      appendMaskStrokePoint(stroke, { x: index, y: 1 });
      const committed = commitMaskStroke(state, stroke);
      state = { history: committed.history, redo: committed.redo };
      expect(committed.droppedStrokes).toBe(index === MAX_MASK_HISTORY_STROKES ? 1 : 0);
      expect(committed.evictedStrokes).toHaveLength(index === MAX_MASK_HISTORY_STROKES ? 1 : 0);
    }
    expect(state.history).toHaveLength(MAX_MASK_HISTORY_STROKES);
    expect(state.history[0].points[0].x).toBe(1);

    state = undoMaskStroke(state);
    expect(state.history).toHaveLength(MAX_MASK_HISTORY_STROKES - 1);
    expect(state.redo).toHaveLength(1);
    state = redoMaskStroke(state);
    expect(state.history).toHaveLength(MAX_MASK_HISTORY_STROKES);
    expect(state.redo).toHaveLength(0);
  });

  it("clears redo after a new stroke and ignores empty commits", () => {
    const first = createMaskStroke("paint", 8);
    appendMaskStrokePoint(first, { x: 0, y: 0 });
    const committed = commitMaskStroke({ history: [], redo: [] }, first);
    const undone = undoMaskStroke(committed);
    expect(commitMaskStroke(undone, createMaskStroke("erase", 8))).toMatchObject({
      history: undone.history,
      redo: undone.redo,
      droppedStrokes: 0,
      evictedStrokes: [],
    });

    const second = createMaskStroke("erase", 8);
    appendMaskStrokePoint(second, { x: 1, y: 1 });
    expect(commitMaskStroke(undone, second).redo).toEqual([]);
  });
});

function emptyState() {
  return { history: [] as ReturnType<typeof createMaskStroke>[], redo: [] as ReturnType<typeof createMaskStroke>[] };
}
