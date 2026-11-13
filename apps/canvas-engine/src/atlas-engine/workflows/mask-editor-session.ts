import {
  appendAtlasMaskPoint,
  commitAtlasMaskStroke,
  createAtlasMaskStroke,
  redoAtlasMaskStroke,
  undoAtlasMaskStroke,
  type AtlasMaskDrawMode,
  type AtlasMaskPoint,
  type AtlasMaskStroke,
  type AtlasMaskStrokeHistory,
} from "./mask-strokes";

/** The editor owns ink/history; its renderer owns pixels. Neither depends on React. */
export interface MaskInkSurface {
  trace(stroke: AtlasMaskStroke, samples: readonly AtlasMaskPoint[]): void;
  checkpoint(strokes: readonly AtlasMaskStroke[]): void;
  restore(strokes: readonly AtlasMaskStroke[]): void;
  clear(): void;
}

type MaskEditorSnapshot = Readonly<{
  drawing: boolean;
  undoCount: number;
  redoCount: number;
  hasCheckpoint: boolean;
}>;

export class MaskEditorSession {
  private ink: MaskInkSurface | null = null;
  private journal: AtlasMaskStrokeHistory = { history: [], redo: [] };
  private active: { pointer: number; stroke: AtlasMaskStroke } | null = null;
  private listeners = new Set<() => void>();
  private snapshot: MaskEditorSnapshot = {
    drawing: false,
    undoCount: 0,
    redoCount: 0,
    hasCheckpoint: false,
  };

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  attach(surface: MaskInkSurface | null) {
    this.ink = surface;
    surface?.restore(this.journal.history);
  }

  begin(
    pointer: number,
    mode: AtlasMaskDrawMode,
    size: number,
    point: AtlasMaskPoint,
  ) {
    if (!this.ink || this.active || !Number.isFinite(size) || size <= 0)
      return false;
    const stroke = createAtlasMaskStroke(mode, size);
    if (!appendAtlasMaskPoint(stroke, point)) return false;
    this.active = { pointer, stroke };
    this.ink.trace(stroke, [point]);
    this.publish();
    return true;
  }

  append(pointer: number, samples: readonly AtlasMaskPoint[], final = false) {
    const active = this.active;
    if (!active || active.pointer !== pointer) return false;
    const tail = active.stroke.points.at(-1)!;
    const accepted = [tail];
    samples.forEach((point, index) => {
      if (
        appendAtlasMaskPoint(
          active.stroke,
          point,
          final && index === samples.length - 1,
        )
      )
        accepted.push(active.stroke.points.at(-1)!);
    });
    if (accepted.length === 1) return false;
    this.ink?.trace(active.stroke, accepted);
    return true;
  }

  end(pointer: number, commit: boolean, endpoint?: AtlasMaskPoint) {
    const active = this.active;
    if (!active || active.pointer !== pointer) return false;
    if (commit && endpoint) this.append(pointer, [endpoint], true);
    this.active = null;
    if (commit) {
      const entry = commitAtlasMaskStroke(this.journal, active.stroke);
      this.journal = { history: entry.history, redo: entry.redo };
      if (entry.evictedStrokes.length) {
        this.ink?.checkpoint(entry.evictedStrokes);
        this.snapshot = { ...this.snapshot, hasCheckpoint: true };
      }
    } else {
      this.ink?.restore(this.journal.history);
    }
    this.publish();
    return true;
  }

  cancel() {
    if (this.active) this.end(this.active.pointer, false);
  }

  undo = () => this.seek(false);
  redo = () => this.seek(true);

  reset = () => {
    this.active = null;
    this.journal = { history: [], redo: [] };
    this.snapshot = { ...this.snapshot, hasCheckpoint: false };
    this.ink?.clear();
    this.publish();
  };

  private seek(forward: boolean) {
    if (this.active) return;
    const before = this.journal;
    const after = forward
      ? redoAtlasMaskStroke(before)
      : undoAtlasMaskStroke(before);
    if (before === after) return;
    const lost = forward ? before.history.length + 1 - after.history.length : 0;
    if (lost > 0) this.ink?.checkpoint(before.history.slice(0, lost));
    this.journal = after;
    this.ink?.restore(after.history);
    this.publish();
  }

  private publish() {
    this.snapshot = {
      ...this.snapshot,
      drawing: this.active !== null,
      undoCount: this.journal.history.length,
      redoCount: this.journal.redo.length,
    };
    this.listeners.forEach((listener) => listener());
  }
}
