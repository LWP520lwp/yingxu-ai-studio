import { describe, expect, it, vi } from "vitest";

import {
  resolveAtlasShortcut,
  runAtlasGeneration,
} from "@/atlas-engine/workflows/async-flow";

function options(overrides: Record<string, unknown> = {}) {
  const controller = new AbortController();
  return {
    controller,
    value: {
      begin: vi.fn(() => controller),
      prepare: vi.fn(async () => ({ prompt: "ready" })),
      shouldSkip: vi.fn(() => false),
      execute: vi.fn(async () => {}),
      ignoreError: vi.fn(() => false),
      onError: vi.fn(),
      finish: vi.fn(),
      ...overrides,
    },
  };
}

describe("Atlas generation lifecycle", () => {
  it("runs preparation and generation in order, then releases the request", async () => {
    const state = options();
    const order: string[] = [];
    state.value.begin.mockImplementation(() => { order.push("begin"); return state.controller; });
    state.value.prepare.mockImplementation(async () => { order.push("prepare"); return { prompt: "ready" }; });
    state.value.execute.mockImplementation(async () => { order.push("execute"); });
    state.value.finish.mockImplementation(() => { order.push("finish"); });

    await expect(runAtlasGeneration(state.value)).resolves.toBe("completed");
    expect(order).toEqual(["begin", "prepare", "execute", "finish"]);
  });

  it("skips an empty prepared job and finalizes the controller", async () => {
    const state = options({
      prepare: vi.fn(async () => ({ prompt: "" })),
      shouldSkip: vi.fn((context: { prompt: string }) => context.prompt.length === 0),
    });
    await expect(runAtlasGeneration(state.value)).resolves.toBe("skipped");
    expect(state.value.execute).not.toHaveBeenCalled();
    expect(state.value.finish).toHaveBeenCalledOnce();
  });

  it("treats an aborted request as cancellation and reports other failures", async () => {
    const failure = new Error("provider unavailable");
    const state = options({
      execute: vi.fn(async () => { state.controller.abort(); throw failure; }),
      ignoreError: vi.fn((error: unknown) => error === failure),
    });
    await expect(runAtlasGeneration(state.value)).resolves.toBe("cancelled");
    expect(state.value.onError).not.toHaveBeenCalled();
    expect(state.value.finish).toHaveBeenCalledOnce();

    const active = options({ execute: vi.fn(async () => { throw failure; }) });
    await expect(runAtlasGeneration(active.value)).resolves.toBe("failed");
    expect(active.value.onError).toHaveBeenCalledWith(failure, active.controller);
    expect(active.value.finish).toHaveBeenCalledOnce();
  });
});

const base = {
  key: "x",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  editableTarget: false,
  selectedText: false,
  canGroup: false,
  canUngroup: false,
  selectedNodeCount: 0,
  selectedConnection: false,
};

describe("Atlas shortcut resolution", () => {
  it("respects editable fields and selected text", () => {
    expect(resolveAtlasShortcut({ ...base, key: "z", ctrlKey: true, editableTarget: true })).toBe("none");
    expect(resolveAtlasShortcut({ ...base, key: "c", metaKey: true, selectedText: true })).toBe("none");
  });

  it("maps history, selection, and valid group commands", () => {
    expect(resolveAtlasShortcut({ ...base, key: "z", ctrlKey: true })).toBe("undo");
    expect(resolveAtlasShortcut({ ...base, key: "z", metaKey: true, shiftKey: true })).toBe("redo");
    expect(resolveAtlasShortcut({ ...base, key: "y", ctrlKey: true })).toBe("redo");
    expect(resolveAtlasShortcut({ ...base, key: "a", metaKey: true })).toBe("select-all");
    expect(resolveAtlasShortcut({ ...base, key: "g", ctrlKey: true, canGroup: true })).toBe("group");
    expect(resolveAtlasShortcut({ ...base, key: "g", metaKey: true, shiftKey: true, canUngroup: true })).toBe("ungroup");
  });

  it("chooses node deletion before edge deletion and handles escape", () => {
    expect(resolveAtlasShortcut({ ...base, key: "Backspace", selectedNodeCount: 1, selectedConnection: true })).toBe("delete-nodes");
    expect(resolveAtlasShortcut({ ...base, key: "Delete", selectedConnection: true })).toBe("delete-connection");
    expect(resolveAtlasShortcut({ ...base, key: "Escape" })).toBe("cancel");
  });
});
