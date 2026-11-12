import { CanvasNodeType, type CanvasNodeTypeId } from "@/types/canvas";

export type CanvasReferenceSelectionState = "target" | "disabled" | "available";

export type CanvasNodePressAction = "drag" | "reference" | "ignore";

export function canvasNodePressAction(
  button: number,
  referenceSelection?: CanvasReferenceSelectionState,
): CanvasNodePressAction {
  if (!referenceSelection) return "drag";
  return button === 0 && referenceSelection === "available"
    ? "reference"
    : "ignore";
}

export type CanvasNodeOpenAction =
  "block" | "plugin" | "image" | "text" | "none";

export function canvasNodeOpenAction({
  referenceSelection,
  hasPluginHandler,
  type,
  hasImageContent,
}: {
  referenceSelection?: CanvasReferenceSelectionState;
  hasPluginHandler: boolean;
  type: CanvasNodeTypeId;
  hasImageContent: boolean;
}): CanvasNodeOpenAction {
  if (referenceSelection) return "block";
  if (hasPluginHandler) return "plugin";
  if (type === CanvasNodeType.Image && hasImageContent) return "image";
  return type === CanvasNodeType.Text ? "text" : "none";
}

/** Keep IME confirmation keys inside the input instead of committing a title. */
export function canvasNodeTitleKeyAction(
  key: string,
  composing = false,
  keyCode = 0,
): "commit" | "cancel" | "none" {
  if (composing || keyCode === 229) return "none";
  return key === "Enter" ? "commit" : key === "Escape" ? "cancel" : "none";
}

export type CanvasNodeTitleEditState = {
  nodeId: string;
  sourceTitle: string;
  draft: string;
  editing: boolean;
};

type TitleEditAction =
  | { type: "sync"; nodeId: string; title: string }
  | { type: "start" }
  | { type: "change"; value: string }
  | { type: "cancel" };

export function createCanvasNodeTitleEdit(
  nodeId: string,
  title: string,
): CanvasNodeTitleEditState {
  return { nodeId, sourceTitle: title, draft: title, editing: false };
}

export function reduceCanvasNodeTitleEdit(
  state: CanvasNodeTitleEditState,
  action: TitleEditAction,
): CanvasNodeTitleEditState {
  switch (action.type) {
    case "sync":
      if (state.nodeId !== action.nodeId)
        return createCanvasNodeTitleEdit(action.nodeId, action.title);
      return state.sourceTitle === action.title
        ? state
        : { ...state, sourceTitle: action.title, draft: action.title };
    case "start":
      return { ...state, draft: state.sourceTitle, editing: true };
    case "change":
      return state.editing && state.draft !== action.value
        ? { ...state, draft: action.value }
        : state;
    case "cancel":
      return state.editing
        ? { ...state, draft: state.sourceTitle, editing: false }
        : state;
  }
}

export function settleCanvasNodeTitleEdit(
  state: CanvasNodeTitleEditState,
  fallback: string,
) {
  if (!state.editing) return { state, change: null };
  const title =
    state.draft.trim().slice(0, 64) || state.sourceTitle || fallback;
  return {
    state: { ...state, draft: title, editing: false },
    change:
      title === state.sourceTitle ? null : { nodeId: state.nodeId, title },
  };
}
