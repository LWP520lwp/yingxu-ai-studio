import { describe, expect, it, vi } from "vitest";

import {
  emitAtlasPluginEvent,
  onAtlasPluginEvent,
} from "@/atlas-engine/plugins/events";

let nextTopicId = 0;
const topic = () => `atlas-event-test:${++nextTopicId}`;

describe("Atlas plugin events", () => {
  it("takes a stable listener snapshot and skips listeners removed mid-dispatch", () => {
    const event = topic();
    const calls: string[] = [];
    let stopSecond: () => void = () => undefined;
    const first = () => {
      calls.push("first");
      stopSecond();
      onAtlasPluginEvent(event, () => calls.push("late"));
    };
    const stopFirst = onAtlasPluginEvent(event, first);
    stopSecond = onAtlasPluginEvent(event, () => calls.push("second"));

    emitAtlasPluginEvent(event);
    expect(calls).toEqual(["first"]);

    calls.length = 0;
    emitAtlasPluginEvent(event);
    expect(calls).toEqual(["first", "late"]);
    stopFirst();
  });

  it("isolates listener failures and continues dispatch", () => {
    const event = topic();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const received = vi.fn();
    const stopFailing = onAtlasPluginEvent(event, () => {
      throw new Error("listener failed");
    });
    const stopReceived = onAtlasPluginEvent(event, received);

    emitAtlasPluginEvent(event, { id: 4 });

    expect(report).toHaveBeenCalledWith(
      expect.stringContaining(event),
      expect.any(Error),
    );
    expect(received).toHaveBeenCalledWith({ id: 4 });
    stopFailing();
    stopReceived();
    report.mockRestore();
  });

  it("makes unsubscribe idempotent and isolates events", () => {
    const firstEvent = topic();
    const secondEvent = topic();
    const received = vi.fn();
    const unsubscribe = onAtlasPluginEvent(firstEvent, received);
    unsubscribe();
    unsubscribe();
    emitAtlasPluginEvent(firstEvent);
    emitAtlasPluginEvent(secondEvent);
    expect(received).not.toHaveBeenCalled();
  });
});
