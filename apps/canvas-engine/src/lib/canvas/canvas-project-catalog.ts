import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type {
  CanvasAssistantSession,
  CanvasConnection,
  CanvasNodeData,
  ViewportTransform,
} from "@/types/canvas";

export type CanvasProject = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  chatSessions: CanvasAssistantSession[];
  activeChatId: string | null;
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
  viewport: ViewportTransform;
};

export type CanvasDeletedProject = { id: string; deletedAt: string };
export type CanvasProjectPatch = Partial<
  Pick<
    CanvasProject,
    | "nodes"
    | "connections"
    | "chatSessions"
    | "activeChatId"
    | "backgroundMode"
    | "showImageInfo"
    | "viewport"
  >
>;
export type CanvasCatalog = {
  projects: CanvasProject[];
  deletedProjects: CanvasDeletedProject[];
};

const DEFAULT_VIEWPORT: ViewportTransform = { x: 0, y: 0, k: 1 };

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createCanvasProject(id: string, title: string, now: string): CanvasProject {
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines",
    showImageInfo: false,
    viewport: { ...DEFAULT_VIEWPORT },
  };
}

export function importCanvasProject(
  source: Partial<CanvasProject>,
  id: string,
  now: string,
  fallbackTitle: string,
): CanvasProject {
  return {
    id,
    title: source.title || fallbackTitle,
    createdAt: source.createdAt || now,
    updatedAt: now,
    nodes: deepClone(source.nodes || []),
    connections: deepClone(source.connections || []),
    chatSessions: deepClone(source.chatSessions || []),
    activeChatId: source.activeChatId ?? null,
    backgroundMode: source.backgroundMode || "lines",
    showImageInfo: source.showImageInfo || false,
    viewport: { ...(source.viewport || DEFAULT_VIEWPORT) },
  };
}

export function renameCanvasProject(
  projects: CanvasProject[],
  id: string,
  title: string,
  now: string,
) {
  const current = projects.find((project) => project.id === id);
  const nextTitle = title.trim() || current?.title;
  if (!current || nextTitle === current.title) return projects;
  return projects.map((project) =>
    project.id === id ? { ...project, title: nextTitle!, updatedAt: now } : project,
  );
}

export function updateCanvasProject(
  projects: CanvasProject[],
  id: string,
  patch: CanvasProjectPatch,
  now: string,
) {
  const current = projects.find((project) => project.id === id);
  if (!current || Object.entries(patch).every(([key, value]) => current[key as keyof CanvasProject] === value)) return projects;
  return projects.map((project) =>
    project.id === id ? { ...project, ...patch, updatedAt: now } : project,
  );
}

export function deleteCanvasProjects(
  catalog: CanvasCatalog,
  ids: string[],
  now: string,
): CanvasCatalog {
  const removing = new Set(ids);
  if (!removing.size) return catalog;
  const deletedById = new Map(catalog.deletedProjects.map((item) => [item.id, item]));
  for (const id of removing) deletedById.set(id, { id, deletedAt: now });
  return {
    projects: catalog.projects.filter((project) => !removing.has(project.id)),
    deletedProjects: [...deletedById.values()],
  };
}

export function replaceCanvasCatalog(
  projects: CanvasProject[],
  deletedProjects: CanvasDeletedProject[],
): CanvasCatalog {
  const latestTombstone = new Map<string, CanvasDeletedProject>();
  let hasDuplicates = false;
  for (const tombstone of deletedProjects) {
    const current = latestTombstone.get(tombstone.id);
    if (current) hasDuplicates = true;
    if (!current || tombstone.deletedAt > current.deletedAt) latestTombstone.set(tombstone.id, tombstone);
  }
  return { projects, deletedProjects: hasDuplicates ? [...latestTombstone.values()] : deletedProjects };
}
