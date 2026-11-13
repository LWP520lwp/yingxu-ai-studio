import { describe, expect, it } from "vitest";
import { atlasPanelTabs, atlasTopBarActionIds, atlasTopBarMenuGroups } from "@/atlas-engine/ui/top-bar-model";

describe("Atlas top bar model", () => {
  it("exposes panels in stable order with unique, grouped actions", () => {
    expect(atlasPanelTabs.map(({ id }) => id)).toEqual(["canvas", "assets", "prompts"]);
    expect(atlasTopBarMenuGroups).toHaveLength(3);
    expect(atlasTopBarActionIds()).toEqual([
      "home", "projects", "create", "panel-canvas", "panel-assets", "panel-prompts",
      "import", "export", "shortcuts",
    ]);
    const actions = atlasTopBarMenuGroups.flatMap((group) => group.map(({ action }) => action));
    expect(new Set(actions).size).toBe(actions.length);
  });
});
