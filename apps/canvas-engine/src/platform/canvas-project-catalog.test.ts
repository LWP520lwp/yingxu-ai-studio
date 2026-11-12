import { describe, expect, it } from "vitest";

import {
  deleteCanvasProjects,
  importCanvasProject,
  renameCanvasProject,
  replaceCanvasCatalog,
  updateCanvasProject,
  type CanvasCatalog,
  type CanvasProject,
} from "@/lib/canvas/canvas-project-catalog";

const project = (id = "one"): CanvasProject => ({
  id,
  title: "Untitled",
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  nodes: [{ id: "node", type: "text", title: "Text", position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { content: "original" } }],
  connections: [],
  chatSessions: [],
  activeChatId: null,
  backgroundMode: "lines",
  showImageInfo: false,
  viewport: { x: 0, y: 0, k: 1 },
});

describe("canvas project catalog", () => {
  it("deep-copies imported project data from its caller", () => {
    const source = project();
    const imported = importCanvasProject(source, "copy", "2026-11-11T01:00:00.000Z", "Imported");
    source.nodes[0].metadata!.content = "changed outside";
    source.viewport.x = 99;

    expect(imported.nodes[0].metadata?.content).toBe("original");
    expect(imported.viewport.x).toBe(0);
  });

  it("preserves identity for unknown or unchanged updates", () => {
    const projects = [project()];
    expect(renameCanvasProject(projects, "missing", "Name", "now")).toBe(projects);
    expect(renameCanvasProject(projects, "one", "   ", "now")).toBe(projects);
    expect(updateCanvasProject(projects, "one", { nodes: projects[0].nodes }, "now")).toBe(projects);
    expect(updateCanvasProject(projects, "missing", { nodes: [] }, "now")).toBe(projects);
  });

  it("deduplicates deletion tombstones while preserving the latest timestamp", () => {
    const catalog: CanvasCatalog = {
      projects: [project()],
      deletedProjects: [{ id: "old", deletedAt: "2026-11-10" }],
    };
    const deleted = deleteCanvasProjects(catalog, ["one", "one", "old"], "2026-11-11");
    expect(deleted.projects).toEqual([]);
    expect(deleted.deletedProjects).toEqual([
      { id: "old", deletedAt: "2026-11-11" },
      { id: "one", deletedAt: "2026-11-11" },
    ]);
    const duplicateInput = replaceCanvasCatalog([], [
      { id: "x", deletedAt: "2026-11-09" },
      { id: "x", deletedAt: "2026-11-11" },
    ]);
    expect(duplicateInput.deletedProjects).toEqual([{ id: "x", deletedAt: "2026-11-11" }]);
    expect(deleteCanvasProjects({ projects: [], deletedProjects: [] }, ["remote-only"], "2026-11-11").deletedProjects).toEqual([
      { id: "remote-only", deletedAt: "2026-11-11" },
    ]);
  });
});
