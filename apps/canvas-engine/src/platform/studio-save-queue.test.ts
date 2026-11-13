import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioSaveQueue } from "@/atlas-engine/studio/studio-save-queue";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("canvas interaction save queue", () => {
  it("a burst of camera and drag frames saves only the latest document after idle", () => {
    vi.useFakeTimers();
    let revision = 0;
    const save = vi.fn(() => revision);
    const queue = createStudioSaveQueue(save);
    for (let i = 0; i < 20; i++) {
      revision++;
      queue.schedule();
      vi.advanceTimersByTime(16);
    }
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.results[0].value).toBe(20);
  });
  it("bounds unsaved work while the user continuously drags", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const queue = createStudioSaveQueue(save);
    for (let i = 0; i < 15; i++) {
      queue.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(save).toHaveBeenCalledOnce();
    queue.schedule();
    vi.advanceTimersByTime(350);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("waits for the full idle interval after the latest frame", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const queue = createStudioSaveQueue(save);
    queue.schedule();
    vi.advanceTimersByTime(340);
    queue.schedule();
    vi.advanceTimersByTime(349);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reuses pending timers during a sustained sequence of drag frames", () => {
    vi.useFakeTimers();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const save = vi.fn();
    const queue = createStudioSaveQueue(save);
    for (let i = 0; i < 90; i++) {
      queue.schedule();
      vi.advanceTimersByTime(16);
    }
    expect(save).not.toHaveBeenCalled();
    expect(timer.mock.calls.length).toBeLessThanOrEqual(6);
    vi.advanceTimersByTime(60);
    expect(save).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("capture or navigation flushes immediately and clears timers", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const queue = createStudioSaveQueue(save);
    queue.schedule();
    queue.flush();
    queue.flush();
    vi.runAllTimers();
    expect(save).toHaveBeenCalledOnce();
  });
  it("disposal prevents an old canvas from saving into a later scope", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const queue = createStudioSaveQueue(save);
    queue.schedule();
    queue.dispose();
    vi.runAllTimers();
    expect(save).not.toHaveBeenCalled();
    queue.schedule();
    queue.flush();
    expect(save).toHaveBeenCalledOnce();
  });
  it("keeps failed work pending so an explicit flush can retry it", () => {
    vi.useFakeTimers();
    const save = vi.fn().mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });
    const queue = createStudioSaveQueue(save);
    queue.schedule();
    expect(queue.flush).toThrow("storage unavailable");
    expect(vi.getTimerCount()).toBe(0);
    queue.flush();
    queue.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("preserves an edit scheduled by the save callback", () => {
    vi.useFakeTimers();
    const save = vi.fn(() => {
      if (save.mock.calls.length === 1) queue.schedule();
    });
    const queue = createStudioSaveQueue(save);
    queue.schedule();
    queue.flush();
    expect(save).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(350);
    expect(save).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
