import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitAtlasPluginEvent,
  onAtlasPluginEvent,
} from "@/atlas-engine/plugins/events";

describe("Atlas plugin event hub", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.restoreAllMocks();
  });

  it("dispatches a snapshot and respects removal during delivery", () => {
    const calls: string[] = [];
    let removeSecond = () => {};
    cleanups.push(
      onAtlasPluginEvent("atlas-test", () => {
        calls.push("first");
        removeSecond();
      }),
    );
    removeSecond = onAtlasPluginEvent("atlas-test", () => calls.push("second"));
    cleanups.push(removeSecond);

    emitAtlasPluginEvent("atlas-test", { ok: true });
    emitAtlasPluginEvent("atlas-test", { ok: true });

    expect(calls).toEqual(["first", "first"]);
  });

  it("isolates subscriber failures so other listeners still receive the event", () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn();
    cleanups.push(
      onAtlasPluginEvent("atlas-error-test", () => {
        throw new Error("plugin failure");
      }),
    );
    cleanups.push(onAtlasPluginEvent("atlas-error-test", handler));

    expect(() => emitAtlasPluginEvent("atlas-error-test", 7)).not.toThrow();
    expect(handler).toHaveBeenCalledWith(7);
    expect(report).toHaveBeenCalledOnce();
  });
});
