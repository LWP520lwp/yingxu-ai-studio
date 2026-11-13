import { describe, expect, it } from "vitest";

import { createAtlasCanvasProject } from "@/atlas-engine/document/project-catalog";
import {
  canvasHistoryProjectPatch,
  createCanvasHistoryEntry,
} from "@/pages/canvas/hooks/use-canvas-history";

describe("canvas history persistence boundary", () => {
  it("keeps undo history out of the persisted project patch", () => {
    const project = createAtlasCanvasProject(
      "history",
      "History",
      "created",
      "Untitled",
    );
    const payload = {
      nodes: [],
      connections: [],
      chatSessions: [],
      activeChatId: null,
      backgroundMode: "dots" as const,
      showImageInfo: true,
    };

    const entry = createCanvasHistoryEntry(project, payload);
    const storedPatch = canvasHistoryProjectPatch(entry);

    expect(entry.base).toBe(project);
    expect(storedPatch).toEqual(payload);
    expect(storedPatch).not.toHaveProperty("base");
    expect(storedPatch).not.toHaveProperty("document");
  });
});
