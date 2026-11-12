import { describe, expect, it } from "vitest";

import {
  buildConnectionCreateEntries,
  visibleCreateMenuDefinitions,
} from "@/components/canvas/canvas-create-menus";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

const definition = (
  type: string,
  showInCreateMenu?: boolean,
): CanvasNodeDefinition => ({
  type,
  title: type,
  icon: null,
  description: `${type} description`,
  defaultSize: { width: 120, height: 80 },
  showInCreateMenu,
});

describe("canvas create menu commands", () => {
  it("keeps connection creation commands ordered and translates their labels", () => {
    const entries = buildConnectionCreateEntries((key) => `translated:${key}`);

    expect(entries.map(({ type }) => type)).toEqual([
      CanvasNodeType.Text,
      CanvasNodeType.Image,
      CanvasNodeType.Video,
      CanvasNodeType.Audio,
      CanvasNodeType.Config,
    ]);
    expect(entries[0].title).toBe("translated:canvas.createMenu.text");
    expect(entries[0].description).toBe(
      "translated:canvas.createMenu.textDescription",
    );
    expect(entries[1].description).toBeUndefined();
    expect(entries[4].description).toBe(
      "translated:canvas.createMenu.configDescription",
    );
  });

  it("filters only definitions explicitly hidden from creation", () => {
    const definitions = [
      definition("image"),
      definition("composition", false),
      definition("plugin:storyboard", true),
    ];

    expect(visibleCreateMenuDefinitions(definitions)).toEqual([
      definitions[0],
      definitions[2],
    ]);
    expect(definitions).toHaveLength(3);
  });
});
