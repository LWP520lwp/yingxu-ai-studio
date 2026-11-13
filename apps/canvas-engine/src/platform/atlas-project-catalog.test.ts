import { describe, expect, it } from "vitest";

import {
  createAtlasCanvasProject,
  deleteAtlasCanvasProjects,
  importAtlasCanvasProject,
  renameAtlasCanvasProject,
  replaceAtlasProjectCatalog,
  updateAtlasCanvasProject,
  type AtlasProjectCatalog,
  type AtlasCanvasProject,
} from "@/atlas-engine/document/project-catalog";

const project = (id = "one"): AtlasCanvasProject => ({
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

describe("Atlas project catalog", () => {
  it("creates normalized projects with independent default viewports", () => {
    const created = createAtlasCanvasProject("new", "  Draft  ", "now", "Untitled");
    expect(created).toMatchObject({
      id: "new",
      title: "Draft",
      createdAt: "now",
      updatedAt: "now",
      viewport: { x: 0, y: 0, k: 1 },
      backgroundMode: "lines",
    });
    created.viewport.x = 12;
    expect(createAtlasCanvasProject("again", "", "now", "Untitled").viewport.x).toBe(0);
  });

  it("imports a detached snapshot and constrains invalid fields", () => {
    const source = project();
    const imported = importAtlasCanvasProject(source, "copy", "later", "Imported");
    source.nodes[0].metadata!.content = "changed outside";
    source.viewport.x = 99;
    expect(imported.nodes[0].metadata?.content).toBe("original");
    expect(imported.viewport.x).toBe(0);

    const malformed = importAtlasCanvasProject({
      title: "  ",
      nodes: null as never,
      connections: "invalid" as never,
      chatSessions: undefined,
      backgroundMode: "unknown" as never,
      showImageInfo: 1 as never,
      viewport: { x: Number.NaN, y: 8, k: 100 },
    }, "normalized", "now", "Imported");
    expect(malformed).toMatchObject({
      title: "Imported",
      nodes: [],
      connections: [],
      chatSessions: [],
      backgroundMode: "lines",
      showImageInfo: false,
      viewport: { x: 0, y: 8, k: 5 },
    });
  });

  it("preserves identity for missing or unchanged records", () => {
    const projects = [project()];
    expect(renameAtlasCanvasProject(projects, "missing", "Name", "now")).toBe(projects);
    expect(renameAtlasCanvasProject(projects, "one", "   ", "now")).toBe(projects);
    expect(updateAtlasCanvasProject(projects, "one", { nodes: projects[0].nodes }, "now")).toBe(projects);
    expect(updateAtlasCanvasProject(projects, "missing", { nodes: [] }, "now")).toBe(projects);
    expect(renameAtlasCanvasProject(projects, "one", "Renamed", "later")[0]).toMatchObject({
      title: "Renamed",
      updatedAt: "later",
    });
  });

  it("keeps one latest deletion tombstone for local and remote deletes", () => {
    const catalog: AtlasProjectCatalog = {
      projects: [project()],
      deletedProjects: [{ id: "old", deletedAt: "2026-11-10" }],
    };
    const deleted = deleteAtlasCanvasProjects(catalog, ["one", "one", "old"], "2026-11-11");
    expect(deleted.projects).toEqual([]);
    expect(deleted.deletedProjects).toEqual([
      { id: "old", deletedAt: "2026-11-11" },
      { id: "one", deletedAt: "2026-11-11" },
    ]);

    const normalized = replaceAtlasProjectCatalog([], [
      { id: "x", deletedAt: "2026-11-09" },
      { id: "x", deletedAt: "2026-11-11" },
    ]);
    expect(normalized.deletedProjects).toEqual([{ id: "x", deletedAt: "2026-11-11" }]);
    expect(deleteAtlasCanvasProjects({ projects: [], deletedProjects: [] }, ["remote-only"], "now").deletedProjects).toEqual([
      { id: "remote-only", deletedAt: "now" },
    ]);
  });
});
