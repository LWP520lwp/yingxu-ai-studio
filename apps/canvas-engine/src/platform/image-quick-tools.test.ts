import { describe, expect, it } from "vitest";

import {
  defaultImageQuickToolIds,
  getImageQuickToolSelectionChanges,
  normalizeImageQuickToolIds,
  readImageQuickToolsConfig,
  setImageQuickToolVisibility,
} from "@/atlas-engine/ui/image-quick-tools";

describe("image quick-tool preferences", () => {
  it("filters unknown values, removes duplicates and returns display order", () => {
    expect(
      normalizeImageQuickToolIds([
        "angle",
        "info",
        "angle",
        "future-tool",
        "delete",
        "copyPrompt",
      ]),
    ).toEqual(["info", "delete", "copyPrompt", "angle"]);
  });

  it("reads legacy arrays and partial preference objects safely", () => {
    expect(readImageQuickToolsConfig(["view", "info"])).toEqual({
      ids: ["info", "view"],
      showLabels: false,
    });
    expect(
      readImageQuickToolsConfig({ ids: ["crop"], showLabels: true }),
    ).toEqual({
      ids: ["crop"],
      showLabels: true,
    });
    expect(
      readImageQuickToolsConfig({ ids: "crop", showLabels: "true" }),
    ).toEqual({
      ids: defaultImageQuickToolIds,
      showLabels: false,
    });
    expect(readImageQuickToolsConfig(null)).toEqual({
      ids: defaultImageQuickToolIds,
      showLabels: false,
    });
  });

  it("toggles tools idempotently and keeps canonical ordering", () => {
    expect(
      setImageQuickToolVisibility(["angle", "crop"], "crop", true),
    ).toEqual(["crop", "angle"]);
    expect(
      setImageQuickToolVisibility(["crop", "crop"], "crop", false),
    ).toEqual([]);
  });

  it("reports only changed action tools in the toolbar's order", () => {
    expect(
      getImageQuickToolSelectionChanges(
        ["resize", "crop", "angle"],
        ["info", "crop"],
        ["resize", "angle"],
      ),
    ).toEqual([
      { id: "resize", visible: true },
      { id: "crop", visible: false },
      { id: "angle", visible: true },
    ]);
  });
});
