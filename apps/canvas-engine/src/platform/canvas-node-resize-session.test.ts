import { describe, expect, it, vi } from "vitest";

import {
  createCanvasNodeResizeGesture,
  resolveCanvasNodeResize,
  trackCanvasNodeResizePointer,
  type ResizePointerEndReason,
  type ResizePointerPoint,
} from "@/lib/canvas/canvas-node-resize-session";

describe("canvas node resize gesture", () => {
  it("binds resize geometry to its originating pointer", () => {
    const gesture = createCanvasNodeResizeGesture(7, {
      corner: "bottom-right",
      pointerStart: { x: 10, y: 20 },
      position: { x: 4, y: 8 },
      size: { width: 300, height: 200 },
      scale: 2,
      keepRatio: false,
    });

    expect(resolveCanvasNodeResize(gesture, 8, { x: 90, y: 100 })).toBeNull();
    expect(resolveCanvasNodeResize(gesture, 7, { x: 90, y: 100 })).toEqual({
      position: { x: 4, y: 8 },
      width: 340,
      height: 240,
    });
  });

  it("ignores other pointers and sends the final pointer-up position before ending", () => {
    const host = new EventTarget();
    const moves: ResizePointerPoint[] = [];
    const ends: ResizePointerEndReason[] = [];
    trackCanvasNodeResizePointer(host as unknown as Window, 2, {
      onMove: (point) => moves.push(point),
      onEnd: (reason) => ends.push(reason),
    });

    host.dispatchEvent(pointerEvent("pointermove", 3, 40, 50));
    host.dispatchEvent(pointerEvent("pointermove", 2, 41, 51));
    host.dispatchEvent(pointerEvent("pointerup", 3, 60, 70));
    expect(moves).toEqual([{ x: 41, y: 51 }]);
    expect(ends).toEqual([]);

    host.dispatchEvent(pointerEvent("pointerup", 2, 70, 80));
    host.dispatchEvent(pointerEvent("pointercancel", 2, 90, 100));
    host.dispatchEvent(new Event("blur"));
    expect(moves).toEqual([
      { x: 41, y: 51 },
      { x: 70, y: 80 },
    ]);
    expect(ends).toEqual(["up"]);
  });

  it.each([
    ["pointercancel", "cancel"],
    ["blur", "blur"],
  ] as const)("cleans listeners and ends once on %s", (eventName, reason) => {
    const host = new EventTarget();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    trackCanvasNodeResizePointer(host as unknown as Window, 5, {
      onMove,
      onEnd,
    });

    host.dispatchEvent(
      eventName === "blur"
        ? new Event("blur")
        : pointerEvent("pointercancel", 5, 1, 1),
    );
    host.dispatchEvent(pointerEvent("pointermove", 5, 2, 2));
    host.dispatchEvent(new Event("blur"));

    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(reason);
  });

  it("uses unmount cleanup as a single terminal path", () => {
    const host = new EventTarget();
    const onEnd = vi.fn();
    const cleanup = trackCanvasNodeResizePointer(host as unknown as Window, 4, {
      onMove: vi.fn(),
      onEnd,
    });

    cleanup();
    cleanup();
    host.dispatchEvent(pointerEvent("pointerup", 4, 1, 1));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith("unmount");
  });
});

function pointerEvent(
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
) {
  return Object.assign(new Event(type), { pointerId, clientX, clientY });
}
