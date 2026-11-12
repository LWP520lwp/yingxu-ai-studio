import { afterEach, describe, expect, it } from "vitest";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

const project: CanvasProject = {
  id: "source",
  title: "Draft",
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  nodes: [
    {
      id: "text",
      type: "text",
      title: "Script",
      position: { x: 0, y: 0 },
      width: 200,
      height: 100,
      metadata: { content: "original" },
    },
  ],
  connections: [],
  chatSessions: [],
  activeChatId: null,
  backgroundMode: "lines",
  showImageInfo: false,
  viewport: { x: 0, y: 0, k: 1 },
};

afterEach(() => {
  useCanvasStore.setState({ hydrated: true, projects: [], deletedProjects: [] });
});

describe("workspace canvas store", () => {
  it("imports a detached project snapshot with normalized defaults", () => {
    const id = useCanvasStore.getState().importProject({
      ...project,
      id: "ignored",
      title: "  Imported  ",
      viewport: { x: 4, y: 9, k: 0 },
    });
    const imported = useCanvasStore.getState().openProject(id)!;

    project.nodes[0].metadata!.content = "changed outside";
    expect(imported.id).not.toBe("ignored");
    expect(imported.title).toBe("Imported");
    expect(imported.viewport).toEqual({ x: 4, y: 9, k: 1 });
    expect(imported.nodes[0].metadata?.content).toBe("original");
  });

  it("keeps identity for missing or unchanged updates", () => {
    useCanvasStore.setState({ projects: [project] });
    const before = useCanvasStore.getState().projects;
    useCanvasStore.getState().renameProject("missing", "Name");
    useCanvasStore.getState().updateProject("source", { nodes: project.nodes });
    expect(useCanvasStore.getState().projects).toBe(before);
  });

  it("records one latest tombstone for repeated deletes", () => {
    useCanvasStore.setState({ projects: [project], deletedProjects: [] });
    useCanvasStore.getState().deleteProjects(["source", "source"]);
    const state = useCanvasStore.getState();
    expect(state.projects).toEqual([]);
    expect(state.deletedProjects).toHaveLength(1);
    expect(state.deletedProjects[0].id).toBe("source");
  });
});
