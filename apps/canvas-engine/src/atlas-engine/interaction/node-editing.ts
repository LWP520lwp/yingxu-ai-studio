export type AtlasReferenceMode = "target" | "disabled" | "available";
export type AtlasNodePointerIntent = "drag" | "reference" | "ignore";
export type AtlasNodeActivation =
  "block" | "plugin" | "image" | "text" | "none";

export function resolveAtlasNodePointerIntent(
  button: number,
  referenceMode?: AtlasReferenceMode,
): AtlasNodePointerIntent {
  if (referenceMode === undefined) return "drag";
  return button === 0 && referenceMode === "available" ? "reference" : "ignore";
}

export function resolveAtlasNodeActivation(input: {
  referenceMode?: AtlasReferenceMode;
  pluginAvailable: boolean;
  kind: string;
  imageReady: boolean;
}): AtlasNodeActivation {
  if (input.referenceMode !== undefined) return "block";
  if (input.pluginAvailable) return "plugin";
  if (input.kind === "image" && input.imageReady) return "image";
  return input.kind === "text" ? "text" : "none";
}

export function resolveAtlasTitleKey(
  key: string,
  composing = false,
  keyCode = 0,
): "commit" | "cancel" | "none" {
  if (composing || keyCode === 229) return "none";
  if (key === "Enter") return "commit";
  return key === "Escape" ? "cancel" : "none";
}

export type AtlasTitleEdit = Readonly<{
  nodeId: string;
  sourceTitle: string;
  draft: string;
  editing: boolean;
}>;
export type AtlasTitleEditAction =
  | { type: "sync"; nodeId: string; title: string }
  | { type: "start" }
  | { type: "change"; value: string }
  | { type: "cancel" };

export function beginAtlasTitleEdit(
  nodeId: string,
  title: string,
): AtlasTitleEdit {
  return { nodeId, sourceTitle: title, draft: title, editing: false };
}

export function updateAtlasTitleEdit(
  state: AtlasTitleEdit,
  action: AtlasTitleEditAction,
): AtlasTitleEdit {
  if (action.type === "sync") {
    if (state.nodeId !== action.nodeId)
      return beginAtlasTitleEdit(action.nodeId, action.title);
    return state.sourceTitle === action.title
      ? state
      : { ...state, sourceTitle: action.title, draft: action.title };
  }
  if (action.type === "start")
    return { ...state, draft: state.sourceTitle, editing: true };
  if (action.type === "change")
    return state.editing && state.draft !== action.value
      ? { ...state, draft: action.value }
      : state;
  return state.editing
    ? { ...state, draft: state.sourceTitle, editing: false }
    : state;
}

export function commitAtlasTitleEdit(state: AtlasTitleEdit, fallback: string) {
  if (!state.editing) return { state, change: null };
  const title =
    state.draft.trim().slice(0, 64) || state.sourceTitle || fallback;
  return {
    state: { ...state, draft: title, editing: false },
    change:
      title === state.sourceTitle ? null : { nodeId: state.nodeId, title },
  };
}

export type AtlasResizeCorner =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type AtlasResizeInput = {
  corner: AtlasResizeCorner;
  pointerStart: { x: number; y: number };
  pointerNow: { x: number; y: number };
  position: { x: number; y: number };
  size: { width: number; height: number };
  scale: number;
  keepRatio: boolean;
  ratio?: number;
};
export type AtlasResizeResult = {
  position: { x: number; y: number };
  width: number;
  height: number;
};

const MIN_WIDTH = 220;
const MIN_HEIGHT = 160;
const MAX_SIZE = 1_000_000;

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function limit(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, finite(value, low)));
}

export function resizeAtlasNode(input: AtlasResizeInput): AtlasResizeResult {
  const start = {
    x: finite(input.pointerStart.x, 0),
    y: finite(input.pointerStart.y, 0),
  };
  const pointer = {
    x: finite(input.pointerNow.x, start.x),
    y: finite(input.pointerNow.y, start.y),
  };
  const scale =
    Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1;
  const left = finite(input.position.x, 0);
  const top = finite(input.position.y, 0);
  const width0 = limit(input.size.width, MIN_WIDTH, MAX_SIZE);
  const height0 = limit(input.size.height, MIN_HEIGHT, MAX_SIZE);
  const dx = (pointer.x - start.x) / scale;
  const dy = (pointer.y - start.y) / scale;
  const fromLeft = input.corner.includes("left");
  const fromTop = input.corner.includes("top");
  const fixedRight = left + width0;
  const fixedBottom = top + height0;

  let width = limit(width0 + (fromLeft ? -dx : dx), MIN_WIDTH, MAX_SIZE);
  let height = limit(height0 + (fromTop ? -dy : dy), MIN_HEIGHT, MAX_SIZE);
  if (input.keepRatio) {
    const requested = input.ratio;
    const ratio =
      Number.isFinite(requested) && requested! > 0
        ? limit(requested!, MIN_WIDTH / MAX_SIZE, MAX_SIZE / MIN_HEIGHT)
        : width0 / height0;
    const candidate = Math.abs(dx) >= Math.abs(dy) ? width : height * ratio;
    const minWidth = Math.max(MIN_WIDTH, MIN_HEIGHT * ratio);
    const maxWidth = Math.min(MAX_SIZE, MAX_SIZE * ratio);
    width = limit(candidate, minWidth, maxWidth);
    height = limit(width / ratio, MIN_HEIGHT, MAX_SIZE);
  }

  return {
    width,
    height,
    position: {
      x: fromLeft ? finite(fixedRight - width, left) : left,
      y: fromTop ? finite(fixedBottom - height, top) : top,
    },
  };
}

export type AtlasResizeGesture = {
  pointerId: number;
  input: Omit<AtlasResizeInput, "pointerNow">;
};
export type AtlasPointerPoint = { x: number; y: number };
export type AtlasPointerEndReason = "up" | "cancel" | "blur" | "unmount";
export type AtlasPointerHost = Pick<
  Window,
  "addEventListener" | "removeEventListener"
>;
export type AtlasResizePointerCallbacks = {
  onMove: (point: AtlasPointerPoint) => void;
  onEnd: (reason: AtlasPointerEndReason) => void;
};

export function beginAtlasResizeGesture(
  pointerId: number,
  input: Omit<AtlasResizeInput, "pointerNow">,
): AtlasResizeGesture {
  return { pointerId, input };
}

export function resolveAtlasResizeGesture(
  gesture: AtlasResizeGesture | null,
  pointerId: number,
  pointerNow: AtlasPointerPoint,
): AtlasResizeResult | null {
  if (!gesture || gesture.pointerId !== pointerId) return null;
  return resizeAtlasNode({ ...gesture.input, pointerNow });
}

export function observeAtlasResizePointer(
  host: AtlasPointerHost,
  pointerId: number,
  callbacks: AtlasResizePointerCallbacks,
) {
  let active = true;
  const detach = () => {
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerup", onUp);
    host.removeEventListener("pointercancel", onCancel);
    host.removeEventListener("blur", onBlur);
  };
  const finish = (reason: AtlasPointerEndReason) => {
    if (!active) return;
    active = false;
    detach();
    callbacks.onEnd(reason);
  };
  const matches = (event: Event): event is PointerEvent =>
    "pointerId" in event && event.pointerId === pointerId;
  const onMove = (event: Event) => {
    if (active && matches(event))
      callbacks.onMove({ x: event.clientX, y: event.clientY });
  };
  const onUp = (event: Event) => {
    if (!active || !matches(event)) return;
    callbacks.onMove({ x: event.clientX, y: event.clientY });
    finish("up");
  };
  const onCancel = (event: Event) => {
    if (active && matches(event)) finish("cancel");
  };
  const onBlur = () => finish("blur");

  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onCancel);
  host.addEventListener("blur", onBlur);
  return () => finish("unmount");
}
