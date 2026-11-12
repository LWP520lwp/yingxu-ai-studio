export type MaskDrawMode = "paint" | "erase";
export type MaskPoint = { x: number; y: number };
export type MaskStroke = {
  mode: MaskDrawMode;
  size: number;
  points: MaskPoint[];
};
export type MaskStrokeHistory = {
  history: MaskStroke[];
  redo: MaskStroke[];
};

export const MAX_MASK_HISTORY_STROKES = 100;
export const MIN_MASK_SAMPLE_DISTANCE = 0.5;

export function createMaskStroke(mode: MaskDrawMode, size: number): MaskStroke {
  return { mode, size, points: [] };
}

export function appendMaskStrokePoint(
  stroke: MaskStroke,
  point: MaskPoint,
  force = false,
) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const last = stroke.points.at(-1);
  if (last) {
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    if (dx === 0 && dy === 0) return false;
    if (force) {
      stroke.points.push(point);
      return true;
    }
    if (dx * dx + dy * dy < MIN_MASK_SAMPLE_DISTANCE ** 2) return false;
  }
  stroke.points.push(point);
  return true;
}

export function commitMaskStroke(
  state: MaskStrokeHistory,
  stroke: MaskStroke,
): MaskStrokeHistory & { droppedStrokes: number; evictedStrokes: MaskStroke[] } {
  if (!stroke.points.length) return { ...state, droppedStrokes: 0, evictedStrokes: [] };
  const all = [...state.history, stroke];
  const droppedStrokes = Math.max(0, all.length - MAX_MASK_HISTORY_STROKES);
  const evictedStrokes = droppedStrokes ? all.slice(0, droppedStrokes) : [];
  return {
    history: droppedStrokes ? all.slice(droppedStrokes) : all,
    redo: [],
    droppedStrokes,
    evictedStrokes,
  };
}

export function undoMaskStroke(state: MaskStrokeHistory): MaskStrokeHistory {
  const stroke = state.history.at(-1);
  if (!stroke) return state;
  return {
    history: state.history.slice(0, -1),
    redo: [...state.redo, stroke],
  };
}

export function redoMaskStroke(state: MaskStrokeHistory): MaskStrokeHistory {
  const stroke = state.redo.at(-1);
  if (!stroke) return state;
  const all = [...state.history, stroke];
  const droppedStrokes = Math.max(0, all.length - MAX_MASK_HISTORY_STROKES);
  return {
    history: droppedStrokes ? all.slice(droppedStrokes) : all,
    redo: state.redo.slice(0, -1),
  };
}
