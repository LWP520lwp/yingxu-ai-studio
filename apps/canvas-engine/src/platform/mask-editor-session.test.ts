import { describe, expect, it, vi } from "vitest";
import {
  MaskEditorSession,
  type MaskInkSurface,
} from "@/atlas-engine/workflows/mask-editor-session";
import { ATLAS_MASK_HISTORY_LIMIT } from "@/atlas-engine/workflows/mask-strokes";

function editor() {
  const ink: MaskInkSurface = {
    trace: vi.fn(),
    checkpoint: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
  };
  const session = new MaskEditorSession();
  session.attach(ink);
  return { session, ink };
}

describe("mask editing transaction", () => {
  it("draws coalesced sample batches immediately without notifying React for every sample", () => {
    const { session, ink } = editor();
    const changed = vi.fn();
    session.subscribe(changed);
    expect(session.begin(4, "paint", 24, { x: 1, y: 1 })).toBe(true);
    const drawing = session.getSnapshot();
    session.append(4, [
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 4, y: 3 },
    ]);
    expect(session.getSnapshot()).toBe(drawing);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(ink.trace).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "paint" }),
      [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 2 },
        { x: 4, y: 3 },
      ],
    );
    session.end(4, true, { x: 4.1, y: 3 });
    expect(session.getSnapshot()).toMatchObject({
      drawing: false,
      undoCount: 1,
    });
    session.undo();
    session.redo();
    expect(ink.restore).toHaveBeenLastCalledWith([
      expect.objectContaining({
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 3, y: 2 },
          { x: 4, y: 3 },
          { x: 4.1, y: 3 },
        ],
      }),
    ]);
  });

  it("ignores competing pointers, preserves redo on cancellation and restores committed ink", () => {
    const { session, ink } = editor();
    session.begin(1, "paint", 8, { x: 0, y: 0 });
    session.end(1, true);
    session.undo();
    session.begin(2, "erase", 16, { x: 3, y: 3 });
    expect(session.begin(3, "paint", 20, { x: 0, y: 0 })).toBe(false);
    expect(session.append(3, [{ x: 8, y: 8 }])).toBe(false);
    expect(session.end(3, true)).toBe(false);
    session.undo();
    expect(session.getSnapshot().drawing).toBe(true);
    session.cancel();
    expect(ink.restore).toHaveBeenLastCalledWith([]);
    expect(session.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 1,
      drawing: false,
    });
    session.redo();
    expect(session.getSnapshot().undoCount).toBe(1);
  });

  it("flattens only entries beyond the undo limit and retains that base through undo and redo", () => {
    const { session, ink } = editor();
    for (let index = 0; index <= ATLAS_MASK_HISTORY_LIMIT; index++) {
      session.begin(index, index === 0 ? "erase" : "paint", 8, {
        x: index,
        y: 0,
      });
      session.end(index, true);
    }
    expect(session.getSnapshot()).toMatchObject({
      undoCount: 100,
      hasCheckpoint: true,
    });
    expect(ink.checkpoint).toHaveBeenCalledTimes(1);
    expect(ink.checkpoint).toHaveBeenCalledWith([
      expect.objectContaining({ mode: "erase", points: [{ x: 0, y: 0 }] }),
    ]);
    for (let index = 0; index < 100; index++) session.undo();
    expect(ink.restore).toHaveBeenLastCalledWith([]);
    session.redo();
    expect(ink.restore).toHaveBeenLastCalledWith([
      expect.objectContaining({ points: [{ x: 1, y: 0 }] }),
    ]);
    session.reset();
    expect(ink.clear).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toEqual({
      drawing: false,
      undoCount: 0,
      redoCount: 0,
      hasCheckpoint: false,
    });
  });

  it("rejects invalid geometry and forks history only after a valid commit", () => {
    const { session } = editor();
    expect(session.begin(1, "paint", Number.NaN, { x: 0, y: 0 })).toBe(false);
    expect(session.begin(1, "paint", 8, { x: Number.NaN, y: 0 })).toBe(false);
    session.begin(1, "paint", 8, { x: 0, y: 0 });
    session.end(1, true);
    session.undo();
    session.begin(2, "paint", 8, { x: 8, y: 8 });
    session.end(2, true);
    expect(session.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
  });
});
