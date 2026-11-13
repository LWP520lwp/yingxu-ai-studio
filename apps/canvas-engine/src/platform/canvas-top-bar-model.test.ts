import { describe, expect, it } from "vitest";

import {
  atlasTopBarActionIds as canvasTopBarMenuActionIds,
  atlasTopBarMenuGroups as canvasTopBarMenuGroups,
  atlasPanelTabs as canvasTopBarPanelTabs,
} from "@/atlas-engine/ui/top-bar-model";

describe("canvas top bar model", () => {
  it("keeps panel choices in their presentation order", () => {
    expect(canvasTopBarPanelTabs.map(({ id }) => id)).toEqual([
      "canvas",
      "assets",
      "prompts",
    ]);
  });

  it("keeps navigation, panel and utility actions in separate menu groups", () => {
    expect(canvasTopBarMenuGroups).toHaveLength(3);
    expect(canvasTopBarMenuActionIds()).toEqual([
      "home",
      "projects",
      "create",
      "panel-canvas",
      "panel-assets",
      "panel-prompts",
      "import",
      "export",
      "shortcuts",
    ]);
    expect(new Set(canvasTopBarMenuActionIds()).size).toBe(9);

    const commands = canvasTopBarMenuGroups.flatMap((group) =>
      group.map(({ action }) => action),
    );
    expect(commands).toEqual([
      "home",
      "projects",
      "create",
      "panel-canvas",
      "panel-assets",
      "panel-prompts",
      "import",
      "export",
      "shortcuts",
    ]);
    expect(new Set(commands).size).toBe(commands.length);
  });
});
