import { describe, expect, it } from "vitest";
import {
  createSplitWorkspace,
  reduceSplitWorkspace,
  splitGuideKeyboardValue,
  splitPointerPosition,
  type SplitWorkspaceState,
} from "@/components/canvas/split-workspace-interaction";

const grab = (state: SplitWorkspaceState, position = 0.5) =>
  reduceSplitWorkspace(state, {
    type: "grab",
    axis: "vertical",
    index: 0,
    pointerId: 7,
    position,
  });
const point = (state: SplitWorkspaceState, position: number, pointerId = 7) =>
  reduceSplitWorkspace(state, { type: "point", pointerId, position });

describe("split workspace gestures", () => {
  it("preserves the grab offset and records exactly one undo checkpoint after actual movement", () => {
    const initial = createSplitWorkspace();
    let state = grab(initial, 0.52);
    expect(state.document.history).toHaveLength(0);
    expect(point(state, 0.52)).toBe(state);
    state = point(state, 0.62);
    expect(state.document.params.verticalLines?.[0]).toBeCloseTo(0.6);
    for (let index = 0; index < 20; index++)
      state = point(state, 0.62 + index / 1000);
    expect(state.document.history).toHaveLength(1);
    state = reduceSplitWorkspace(state, {
      type: "release",
      pointerId: 7,
      cancel: false,
    });
    expect(state.drag).toBeNull();
    const edited = state.document.params;
    state = reduceSplitWorkspace(state, {
      type: "edit",
      command: { type: "undo" },
    });
    expect(state.document.params).toEqual(initial.document.params);
    state = reduceSplitWorkspace(state, {
      type: "edit",
      command: { type: "redo" },
    });
    expect(state.document.params).toEqual(edited);
  });

  it("cancels to the complete pre-gesture document, including redo and previous selection", () => {
    let initial = reduceSplitWorkspace(createSplitWorkspace(), {
      type: "place",
      axis: "vertical",
      index: 0,
      value: 0.7,
    });
    initial = reduceSplitWorkspace(initial, {
      type: "edit",
      command: { type: "undo" },
    });
    const dragged = point(grab(initial), 0.8);
    expect(dragged.document.redo).toHaveLength(0);
    expect(
      reduceSplitWorkspace(dragged, {
        type: "release",
        pointerId: 7,
        cancel: true,
      }).document,
    ).toBe(initial.document);
  });

  it("ignores unrelated pointers, invalid guides, duplicate grabs and nonfinite positions", () => {
    const initial = createSplitWorkspace();
    const active = grab(initial);
    expect(point(active, 0.8, 99)).toBe(active);
    expect(
      reduceSplitWorkspace(active, {
        type: "release",
        pointerId: 99,
        cancel: true,
      }),
    ).toBe(active);
    expect(grab(active)).toBe(active);
    expect(point(active, Number.NaN)).toBe(active);
    expect(
      reduceSplitWorkspace(initial, {
        type: "grab",
        axis: "horizontal",
        index: 100,
        pointerId: 7,
        position: 0.4,
      }),
    ).toBe(initial);
    expect(
      reduceSplitWorkspace(initial, {
        type: "place",
        axis: "horizontal",
        index: -1,
        value: 0.4,
      }),
    ).toBe(initial);
  });

  it("does not manufacture history for a click or a no-op numeric position", () => {
    const initial = createSplitWorkspace();
    const clicked = reduceSplitWorkspace(grab(initial), {
      type: "release",
      pointerId: 7,
      cancel: false,
    });
    expect(clicked.document.history).toEqual([]);
    expect(clicked.document.active).toEqual({ axis: "vertical", index: 0 });
    expect(
      reduceSplitWorkspace(clicked, {
        type: "place",
        axis: "vertical",
        index: 0,
        value: 0.5,
      }),
    ).toBe(clicked);
  });

  it("keeps neighbor constraints for numeric and keyboard placements and resets in-progress gestures", () => {
    let state = reduceSplitWorkspace(createSplitWorkspace(), {
      type: "edit",
      command: { type: "set-count", axis: "vertical", value: 3 },
    });
    state = reduceSplitWorkspace(state, {
      type: "place",
      axis: "vertical",
      index: 0,
      value: 1,
    });
    expect(state.document.params.verticalLines?.[0]).toBeLessThan(
      state.document.params.verticalLines![1],
    );
    state = reduceSplitWorkspace(state, {
      type: "place",
      axis: "vertical",
      index: 0,
      value: -1,
    });
    expect(state.document.params.verticalLines?.[0]).toBeGreaterThan(0);
    expect(reduceSplitWorkspace(grab(state), { type: "reset" })).toEqual(
      createSplitWorkspace(),
    );
  });
});

describe("split workspace coordinates and keyboard", () => {
  it("uses the current rectangle after zoom, scroll and resize, without clamping the grab offset", () => {
    const pointer = { clientX: 250, clientY: 180 };
    expect(
      splitPointerPosition("vertical", pointer, {
        left: 50,
        top: 100,
        width: 400,
        height: 200,
      }),
    ).toBe(0.5);
    expect(
      splitPointerPosition("vertical", pointer, {
        left: -50,
        top: 100,
        width: 600,
        height: 300,
      }),
    ).toBe(0.5);
    expect(
      splitPointerPosition("horizontal", pointer, {
        left: 0,
        top: 80,
        width: 400,
        height: 200,
      }),
    ).toBe(0.5);
    expect(
      splitPointerPosition("vertical", pointer, {
        left: 400,
        top: 0,
        width: 100,
        height: 100,
      }),
    ).toBe(-1.5);
    expect(
      splitPointerPosition("horizontal", pointer, {
        left: 0,
        top: 0,
        width: 100,
        height: 0,
      }),
    ).toBeNull();
    expect(
      splitPointerPosition(
        "vertical",
        { clientX: Infinity, clientY: 0 },
        { left: 0, top: 0, width: 100, height: 100 },
      ),
    ).toBeNull();
  });

  it("moves one natural image pixel or ten accelerated pixels on the guide axis", () => {
    const image = { width: 1000, height: 500 };
    expect(
      splitGuideKeyboardValue("vertical", "ArrowRight", 0.5, image, false),
    ).toBe(0.501);
    expect(
      splitGuideKeyboardValue("horizontal", "ArrowUp", 0.5, image, true),
    ).toBe(0.48);
    expect(
      splitGuideKeyboardValue("vertical", "ArrowDown", 0.5, image, true),
    ).toBeNull();
    expect(
      splitGuideKeyboardValue("horizontal", "Home", 0.5, image, false),
    ).toBe(0);
    expect(
      splitGuideKeyboardValue("horizontal", "End", 0.5, image, false),
    ).toBe(1);
    expect(
      splitGuideKeyboardValue(
        "horizontal",
        "ArrowDown",
        0.5,
        { width: 0, height: 0 },
        false,
      ),
    ).toBeNull();
  });
});
