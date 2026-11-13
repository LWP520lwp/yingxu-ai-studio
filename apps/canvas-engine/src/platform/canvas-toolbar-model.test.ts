import { describe, expect, it } from "vitest";

import {
  canvasToolbarSections,
  toggleCanvasTool,
} from "@/atlas-engine/ui/canvas-toolbar-model";

describe("canvas toolbar command plan", () => {
  it("groups editing, creation, and project actions in a stable order", () => {
    const sections = canvasToolbarSections({
      canUndo: true,
      canRedo: false,
      extensionCount: 2,
      selectedCount: 1,
    });

    expect(sections.map(({ id }) => id)).toEqual([
      "workflow",
      "create",
      "project",
    ]);
    expect(sections[0].commands.map(({ id }) => id)).toEqual([
      "pan",
      "undo",
      "redo",
      "focus",
      "tidy",
      "audit",
    ]);
    expect(sections[1].commands.at(-1)?.id).toBe("extensions");
    expect(sections[2].commands.map(({ id }) => id)).toContain("delete");
  });

  it("disables unavailable history and focus actions and omits empty controls", () => {
    const sections = canvasToolbarSections({
      canUndo: false,
      canRedo: false,
      extensionCount: 0,
      selectedCount: 0,
    });
    const commands = sections.flatMap(({ commands: items }) => items);
    const disabled = new Set(
      commands.filter((command) => command.disabled).map(({ id }) => id),
    );

    expect(disabled).toEqual(new Set(["undo", "redo", "focus"]));
    expect(
      commands.some(({ id }) => id === "extensions" || id === "delete"),
    ).toBe(false);
    expect(commands.at(-1)?.id).toBe("clear");
  });

  it("toggles the hand tool back to normal selection", () => {
    expect(toggleCanvasTool("select")).toBe("pan");
    expect(toggleCanvasTool("pan")).toBe("select");
  });
});
