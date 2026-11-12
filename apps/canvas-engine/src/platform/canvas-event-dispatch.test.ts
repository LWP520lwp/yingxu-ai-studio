import { describe, expect, it, vi } from "vitest";

import { createCanvasEventDispatch } from "@/lib/canvas/canvas-event-dispatch";

describe("canvas event dispatch", () => {
  it("takes a stable listener snapshot and skips listeners removed mid-dispatch", () => {
    const bus = createCanvasEventDispatch(vi.fn());
    const calls: string[] = [];
    let stopSecond: () => void = () => undefined;
    const first = () => {
      calls.push("first");
      stopSecond();
      bus.on("change", () => calls.push("late"));
    };
    bus.on("change", first);
    stopSecond = bus.on("change", () => calls.push("second"));

    bus.emit("change");
    expect(calls).toEqual(["first"]);

    calls.length = 0;
    bus.emit("change");
    expect(calls).toEqual(["first", "late"]);
  });

  it("isolates listener failures and continues dispatch", () => {
    const report = vi.fn();
    const bus = createCanvasEventDispatch(report);
    const received = vi.fn();
    bus.on("update", () => {
      throw new Error("listener failed");
    });
    bus.on("update", received);

    bus.emit("update", { id: 4 });

    expect(report).toHaveBeenCalledWith("update", expect.any(Error));
    expect(received).toHaveBeenCalledWith({ id: 4 });
  });

  it("makes unsubscribe idempotent and isolates events", () => {
    const bus = createCanvasEventDispatch(vi.fn());
    const received = vi.fn();
    const unsubscribe = bus.on("a", received);
    unsubscribe();
    unsubscribe();
    bus.emit("a");
    bus.emit("b");
    expect(received).not.toHaveBeenCalled();
  });
});
