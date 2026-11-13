import {
  createSplitEditorState,
  reduceSplitEditorState,
  type SplitAxis,
  type SplitEditorAction,
  type SplitEditorState,
} from "@/atlas-engine/workflows/image-splitting-editor";

type Guide = { axis: SplitAxis; index: number };
type Drag = Guide & {
  pointerId: number;
  offset: number;
  checkpoint: SplitEditorState;
  changed: boolean;
};
export type SplitWorkspaceState = {
  document: SplitEditorState;
  drag: Drag | null;
};
export type SplitWorkspaceAction =
  | { type: "reset" }
  | { type: "edit"; command: SplitEditorAction }
  | ({ type: "grab"; pointerId: number; position: number } & Guide)
  | { type: "point"; pointerId: number; position: number }
  | { type: "release"; pointerId: number; cancel: boolean }
  | ({ type: "place"; value: number } & Guide);

export function createSplitWorkspace(): SplitWorkspaceState {
  return { document: createSplitEditorState(), drag: null };
}

function guidePosition(document: SplitEditorState, guide: Guide) {
  const lines =
    guide.axis === "horizontal"
      ? document.params.horizontalLines
      : document.params.verticalLines;
  return lines?.[guide.index];
}

/** Keep gesture rollback separate from the persisted split parameters. */
export function reduceSplitWorkspace(
  state: SplitWorkspaceState,
  action: SplitWorkspaceAction,
): SplitWorkspaceState {
  if (action.type === "reset") return createSplitWorkspace();
  if (action.type === "edit") {
    return {
      document: reduceSplitEditorState(state.document, action.command),
      drag: null,
    };
  }
  if (action.type === "grab") {
    if (state.drag || !Number.isFinite(action.position)) return state;
    const position = guidePosition(state.document, action);
    if (position === undefined) return state;
    return {
      document: reduceSplitEditorState(state.document, {
        type: "select-line",
        axis: action.axis,
        index: action.index,
        record: false,
      }),
      drag: {
        axis: action.axis,
        index: action.index,
        pointerId: action.pointerId,
        offset: action.position - position,
        checkpoint: state.document,
        changed: false,
      },
    };
  }
  if (action.type === "release") {
    if (!state.drag || state.drag.pointerId !== action.pointerId) return state;
    return {
      document: action.cancel ? state.drag.checkpoint : state.document,
      drag: null,
    };
  }
  const guide = action.type === "point" ? state.drag : action;
  if (!guide) return state;
  if (action.type === "point" && action.pointerId !== state.drag?.pointerId)
    return state;
  const value =
    action.type === "point"
      ? action.position - state.drag!.offset
      : action.value;
  if (!Number.isFinite(value)) return state;
  const moved = reduceSplitEditorState(state.document, {
    type: "move-line",
    axis: guide.axis,
    index: guide.index,
    value,
  });
  if (guidePosition(moved, guide) === guidePosition(state.document, guide))
    return state;
  const selected = reduceSplitEditorState(state.document, {
    type: "select-line",
    axis: guide.axis,
    index: guide.index,
    record: action.type === "place" || !state.drag!.changed,
  });
  return {
    document: { ...selected, params: moved.params },
    drag:
      action.type === "point" && state.drag
        ? { ...state.drag, changed: true }
        : null,
  };
}

/** Read a fresh image rectangle on every event so scrolling and zoom remain safe. */
export function splitPointerPosition(
  axis: SplitAxis,
  point: { clientX: number; clientY: number },
  box: { left: number; top: number; width: number; height: number },
): number | null {
  const horizontal = axis === "horizontal";
  const span = horizontal ? box.height : box.width;
  const position = horizontal
    ? point.clientY - box.top
    : point.clientX - box.left;
  return span > 0 && Number.isFinite(span) && Number.isFinite(position)
    ? position / span
    : null;
}

export function splitGuideKeyboardValue(
  axis: SplitAxis,
  key: string,
  position: number,
  image: { width: number; height: number },
  accelerated: boolean,
): number | null {
  const pixels = axis === "horizontal" ? image.height : image.width;
  if (!(pixels > 0) || !Number.isFinite(pixels)) return null;
  if (key === "Home") return 0;
  if (key === "End") return 1;
  const direction =
    key === (axis === "horizontal" ? "ArrowUp" : "ArrowLeft")
      ? -1
      : key === (axis === "horizontal" ? "ArrowDown" : "ArrowRight")
        ? 1
        : 0;
  return direction
    ? position + (direction * (accelerated ? 10 : 1)) / pixels
    : null;
}
