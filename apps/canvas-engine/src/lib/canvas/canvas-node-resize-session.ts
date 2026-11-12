import {
  resizeCanvasNode,
  type CanvasNodeResizeInput,
  type CanvasNodeResizeResult,
} from "@/lib/canvas/canvas-node-resize";

export type CanvasNodeResizeGesture = {
  pointerId: number;
  input: Omit<CanvasNodeResizeInput, "pointerNow">;
};

export type ResizePointerPoint = { x: number; y: number };
export type ResizePointerEndReason = "up" | "cancel" | "blur" | "unmount";

export type ResizePointerHost = Pick<
  Window,
  "addEventListener" | "removeEventListener"
>;

export type ResizePointerCallbacks = {
  onMove: (point: ResizePointerPoint) => void;
  onEnd: (reason: ResizePointerEndReason) => void;
};

export function createCanvasNodeResizeGesture(
  pointerId: number,
  input: Omit<CanvasNodeResizeInput, "pointerNow">,
): CanvasNodeResizeGesture {
  return { pointerId, input };
}

export function resolveCanvasNodeResize(
  gesture: CanvasNodeResizeGesture | null,
  pointerId: number,
  pointerNow: ResizePointerPoint,
): CanvasNodeResizeResult | null {
  if (!gesture || gesture.pointerId !== pointerId) return null;
  return resizeCanvasNode({ ...gesture.input, pointerNow });
}

export function trackCanvasNodeResizePointer(
  host: ResizePointerHost,
  pointerId: number,
  callbacks: ResizePointerCallbacks,
) {
  let active = true;

  const detach = () => {
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerup", onUp);
    host.removeEventListener("pointercancel", onCancel);
    host.removeEventListener("blur", onBlur);
  };

  const finish = (reason: ResizePointerEndReason) => {
    if (!active) return;
    active = false;
    detach();
    callbacks.onEnd(reason);
  };

  const matches = (event: Event): event is PointerEvent =>
    "pointerId" in event && event.pointerId === pointerId;

  const onMove = (event: Event) => {
    if (!active || !matches(event)) return;
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
