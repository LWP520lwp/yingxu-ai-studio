import { describe, expect, it } from "vitest";

import { resolveCanvasShortcutIntent } from "@/product-engine/canvas-shortcut-intent";

const defaults = {
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

describe("canvas shortcut intent", () => {
  it("ignores shortcuts inside editable controls and preserves copied text", () => {
    expect(
      resolveCanvasShortcutIntent({
        ...defaults,
        key: "z",
        ctrlKey: true,
        editableTarget: true,
      }),
    ).toBe("none");
    expect(
      resolveCanvasShortcutIntent({
        ...defaults,
        key: "c",
        metaKey: true,
        selectedText: true,
      }),
    ).toBe("none");
  });

  it("maps history and selection modifiers with platform parity", () => {
    expect(
      resolveCanvasShortcutIntent({ ...defaults, key: "z", ctrlKey: true }),
    ).toBe("undo");
    expect(
      resolveCanvasShortcutIntent({
        ...defaults,
        key: "z",
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe("redo");
    expect(
      resolveCanvasShortcutIntent({ ...defaults, key: "y", ctrlKey: true }),
    ).toBe("redo");
    expect(
      resolveCanvasShortcutIntent({ ...defaults, key: "a", metaKey: true }),
    ).toBe("select-all");
  });

  it("only dispatches group actions when the selected nodes support them", () => {
    expect(
      resolveCanvasShortcutIntent({
        ...defaults,
        key: "g",
        ctrlKey: true,
        canGroup: true,
      }),
    ).toBe("group");
    expect(
      resolveCanvasShortcutIntent({
        ...defaults,
        key: "g",
        metaKey: true,
        shiftKey: true,
        canUngroup: true,
      }),
    ).toBe("ungroup");
    expect(
      resolveCanvasShortcutIntent({ ...defaults, key: "g", ctrlKey: true }),
    ).toBe("none");
  });

  it("prefers node deletion, then a selected edge, and supports escape", () => {
    expect(
      resolveCanvasShortcutIntent({
        ...defaults,
        key: "Backspace",
        selectedNodeCount: 1,
      }),
    ).toBe("delete-nodes");
    expect(
      resolveCanvasShortcutIntent({
        ...defaults,
        key: "Delete",
        selectedConnection: true,
      }),
    ).toBe("delete-connection");
    expect(resolveCanvasShortcutIntent({ ...defaults, key: "Escape" })).toBe(
      "cancel",
    );
    expect(resolveCanvasShortcutIntent({ ...defaults, key: "Delete" })).toBe(
      "none",
    );
  });
});
