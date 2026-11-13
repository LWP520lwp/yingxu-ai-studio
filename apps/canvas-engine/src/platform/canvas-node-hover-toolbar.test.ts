import { describe, expect, it } from "vitest";

import { reduceCanvasNodeToolbarSession } from "@/components/canvas/canvas-node-hover-toolbar";

describe("canvas node toolbar session", () => {
  it("keeps independent popover, skill, and preparation states", () => {
    const initial = {
      settingsOpen: false,
      skillOpen: false,
      skillId: "",
      preparing: false,
    };
    const selected = reduceCanvasNodeToolbarSession(initial, {
      type: "skill",
      id: "motion-reel",
    });
    const opened = reduceCanvasNodeToolbarSession(selected, {
      type: "skill-menu",
      open: true,
    });

    expect(selected.skillId).toBe("motion-reel");
    expect(opened).toEqual({ ...selected, skillOpen: true });
    expect(
      reduceCanvasNodeToolbarSession(opened, {
        type: "preparing",
        active: true,
      }),
    ).toEqual({ ...opened, preparing: true });
  });

  it("clears transient controls when the active node or project changes", () => {
    const active = {
      settingsOpen: true,
      skillOpen: true,
      skillId: "motion-reel",
      preparing: true,
    };

    expect(reduceCanvasNodeToolbarSession(active, { type: "reset" })).toEqual({
      settingsOpen: false,
      skillOpen: false,
      skillId: "",
      preparing: false,
    });
  });
});
