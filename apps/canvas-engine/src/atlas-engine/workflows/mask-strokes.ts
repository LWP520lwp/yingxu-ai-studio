export type AtlasMaskDrawMode = "paint" | "erase";
export type AtlasMaskPoint = Readonly<{ x: number; y: number }>;
export type AtlasMaskStroke = {
  mode: AtlasMaskDrawMode;
  size: number;
  points: AtlasMaskPoint[];
};
export type AtlasMaskStrokeHistory = {
  history: AtlasMaskStroke[];
  redo: AtlasMaskStroke[];
};

export const ATLAS_MASK_HISTORY_LIMIT = 100;
export const ATLAS_MASK_SAMPLE_DISTANCE = 0.5;

export function createAtlasMaskStroke(
  mode: AtlasMaskDrawMode,
  size: number,
): AtlasMaskStroke {
  return { mode, size, points: [] };
}

export function appendAtlasMaskPoint(
  stroke: AtlasMaskStroke,
  point: AtlasMaskPoint,
  force = false,
): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const previous = stroke.points[stroke.points.length - 1];
  if (previous) {
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    if (dx === 0 && dy === 0) return false;
    if (!force && dx * dx + dy * dy < ATLAS_MASK_SAMPLE_DISTANCE ** 2) {
      return false;
    }
  }
  stroke.points.push({ x: point.x, y: point.y });
  return true;
}

export function commitAtlasMaskStroke(
  state: AtlasMaskStrokeHistory,
  stroke: AtlasMaskStroke,
): AtlasMaskStrokeHistory & {
  droppedStrokes: number;
  evictedStrokes: AtlasMaskStroke[];
} {
  if (stroke.points.length === 0) {
    return { ...state, droppedStrokes: 0, evictedStrokes: [] };
  }
  const next = [...state.history, stroke];
  const overflow = Math.max(0, next.length - ATLAS_MASK_HISTORY_LIMIT);
  return {
    history: overflow ? next.slice(overflow) : next,
    redo: [],
    droppedStrokes: overflow,
    evictedStrokes: overflow ? next.slice(0, overflow) : [],
  };
}

export function undoAtlasMaskStroke(
  state: AtlasMaskStrokeHistory,
): AtlasMaskStrokeHistory {
  const stroke = state.history[state.history.length - 1];
  if (!stroke) return state;
  return {
    history: state.history.slice(0, -1),
    redo: [...state.redo, stroke],
  };
}

export function redoAtlasMaskStroke(
  state: AtlasMaskStrokeHistory,
): AtlasMaskStrokeHistory {
  const stroke = state.redo[state.redo.length - 1];
  if (!stroke) return state;
  const next = [...state.history, stroke];
  const overflow = Math.max(0, next.length - ATLAS_MASK_HISTORY_LIMIT);
  return {
    history: overflow ? next.slice(overflow) : next,
    redo: state.redo.slice(0, -1),
  };
}
