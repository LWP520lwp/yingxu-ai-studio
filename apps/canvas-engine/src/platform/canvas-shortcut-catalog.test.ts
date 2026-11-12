import { describe, expect, it } from "vitest";
import { canvasShortcutCatalog } from "@/lib/canvas/canvas-shortcut-catalog";

describe("canvas shortcut catalog", () => {
  it("keeps each visible shortcut uniquely keyed and localized", () => {
    const shortcuts = canvasShortcutCatalog((key) => `translated:${key}`);

    expect(shortcuts).toHaveLength(15);
    expect(new Set(shortcuts.map(({ id }) => id)).size).toBe(shortcuts.length);
    expect(
      shortcuts.every(({ description }) =>
        description.startsWith("translated:"),
      ),
    ).toBe(true);
    expect(shortcuts.find(({ id }) => id === "undo")).toMatchObject({
      keys: ["Ctrl / Cmd", "Z"],
      description: "translated:canvas.undo",
    });
  });
});
