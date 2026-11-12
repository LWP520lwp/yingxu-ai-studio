import type { ImageSplitParams } from "@/lib/canvas/canvas-image-data";

export type SplitAxis = "horizontal" | "vertical";
export type SplitEditorSelection = { axis: SplitAxis; index: number } | null;
export type SplitEditorState = {
  params: ImageSplitParams;
  active: SplitEditorSelection;
  history: ImageSplitParams[];
  redo: ImageSplitParams[];
};

export type SplitEditorAction =
  | { type: "reset" }
  | { type: "set-count"; axis: SplitAxis; value: number | string | null }
  | { type: "add-line"; axis: SplitAxis }
  | { type: "select-line"; axis: SplitAxis; index: number; record: boolean }
  | { type: "move-line"; axis: SplitAxis; index: number; value: number }
  | { type: "delete-active" }
  | { type: "reset-lines" }
  | { type: "undo" }
  | { type: "redo" };

export const SPLIT_EDITOR_HISTORY_LIMIT = 50;
const MAX_GRID_SIZE = 12;

export function createSplitEditorState(): SplitEditorState {
  return {
    params: {
      rows: 2,
      columns: 2,
      horizontalLines: [0.5],
      verticalLines: [0.5],
    },
    active: null,
    history: [],
    redo: [],
  };
}

export function reduceSplitEditorState(
  state: SplitEditorState,
  action: SplitEditorAction,
): SplitEditorState {
  switch (action.type) {
    case "reset":
      return createSplitEditorState();
    case "set-count": {
      const count = clampGrid(
        action.value ?? axisCount(state.params, action.axis),
      );
      const next = {
        ...state.params,
        [action.axis === "horizontal" ? "rows" : "columns"]: count,
        [lineKey(action.axis)]: buildGridLines(count),
      };
      return commit(state, next, null);
    }
    case "add-line": {
      const lines = linesFor(state.params, action.axis);
      if (lines.length >= MAX_GRID_SIZE - 1) return state;
      const spot = findLineSpot(lines);
      const nextLines = [...lines, spot].sort((a, b) => a - b);
      return commit(
        state,
        {
          ...state.params,
          [lineKey(action.axis)]: nextLines,
          [action.axis === "horizontal" ? "rows" : "columns"]:
            nextLines.length + 1,
        },
        { axis: action.axis, index: nextLines.indexOf(spot) },
      );
    }
    case "select-line":
      if (!isValidLine(state.params, action.axis, action.index)) return state;
      return {
        ...state,
        active: { axis: action.axis, index: action.index },
        ...(action.record
          ? { history: appendHistory(state.history, state.params), redo: [] }
          : {}),
      };
    case "move-line": {
      if (!isValidLine(state.params, action.axis, action.index)) return state;
      const lines = [...linesFor(state.params, action.axis)];
      lines[action.index] = clampLine(
        action.value,
        lines[action.index - 1] ?? 0,
        lines[action.index + 1] ?? 1,
      );
      return {
        ...state,
        params: { ...state.params, [lineKey(action.axis)]: lines },
      };
    }
    case "delete-active": {
      if (!state.active) return state;
      const axis = state.active.axis;
      const nextLines = linesFor(state.params, axis).filter(
        (_, index) => index !== state.active?.index,
      );
      return commit(
        state,
        {
          ...state.params,
          [lineKey(axis)]: nextLines,
          [axis === "horizontal" ? "rows" : "columns"]: nextLines.length + 1,
        },
        null,
      );
    }
    case "reset-lines":
      return commit(
        state,
        {
          ...state.params,
          horizontalLines: buildGridLines(state.params.rows),
          verticalLines: buildGridLines(state.params.columns),
        },
        null,
      );
    case "undo": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return {
        ...state,
        params: cloneParams(previous),
        active: null,
        history: state.history.slice(0, -1),
        redo: appendHistory(state.redo, state.params),
      };
    }
    case "redo": {
      const next = state.redo.at(-1);
      if (!next) return state;
      return {
        ...state,
        params: cloneParams(next),
        active: null,
        history: appendHistory(state.history, state.params),
        redo: state.redo.slice(0, -1),
      };
    }
  }
}

export function splitEditorCounts(params: ImageSplitParams) {
  const horizontalLines = params.horizontalLines || [];
  const verticalLines = params.verticalLines || [];
  return {
    horizontalLines,
    verticalLines,
    rows: horizontalLines.length + 1,
    columns: verticalLines.length + 1,
  };
}

function commit(
  state: SplitEditorState,
  params: ImageSplitParams,
  active: SplitEditorSelection,
): SplitEditorState {
  return {
    params: cloneParams(params),
    active,
    history: appendHistory(state.history, state.params),
    redo: [],
  };
}

function appendHistory(history: ImageSplitParams[], params: ImageSplitParams) {
  return [...history, cloneParams(params)].slice(-SPLIT_EDITOR_HISTORY_LIMIT);
}

function cloneParams(params: ImageSplitParams): ImageSplitParams {
  return {
    ...params,
    horizontalLines: [...(params.horizontalLines || [])],
    verticalLines: [...(params.verticalLines || [])],
  };
}

function axisCount(params: ImageSplitParams, axis: SplitAxis) {
  return axis === "horizontal" ? params.rows : params.columns;
}

function lineKey(axis: SplitAxis) {
  return axis === "horizontal" ? "horizontalLines" : "verticalLines";
}

function linesFor(params: ImageSplitParams, axis: SplitAxis) {
  return params[lineKey(axis)] || [];
}

function isValidLine(params: ImageSplitParams, axis: SplitAxis, index: number) {
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < linesFor(params, axis).length
  );
}

function buildGridLines(count: number) {
  return Array.from(
    { length: Math.max(1, count) - 1 },
    (_, index) => (index + 1) / count,
  );
}

function findLineSpot(lines: number[]) {
  const cuts = [0, ...lines, 1].sort((a, b) => a - b);
  let spot = 0.5;
  let max = 0;
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const gap = cuts[index + 1] - cuts[index];
    if (gap > max) {
      max = gap;
      spot = cuts[index] + gap / 2;
    }
  }
  return spot;
}

function clampLine(value: number, min: number, max: number) {
  const safeValue = Number.isFinite(value) ? value : (min + max) / 2;
  const margin = Math.min(0.01, Math.max(0, (max - min) / 2));
  return Math.min(max - margin, Math.max(min + margin, safeValue));
}

function clampGrid(value: number | string) {
  const numberValue = Number(value);
  return Math.min(
    MAX_GRID_SIZE,
    Math.max(1, Math.round(Number.isFinite(numberValue) ? numberValue : 1)),
  );
}
