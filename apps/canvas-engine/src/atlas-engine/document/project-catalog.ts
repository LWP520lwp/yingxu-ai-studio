import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type {
  CanvasAssistantSession,
  CanvasConnection,
  CanvasNodeData,
  ViewportTransform,
} from "@/types/canvas";

export type AtlasCanvasProject = {
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

export type AtlasDeletedProject = { id: string; deletedAt: string };
export type AtlasProjectPatch = Partial<
  Pick<
    AtlasCanvasProject,
    | "nodes"
    | "connections"
    | "chatSessions"
    | "activeChatId"
    | "backgroundMode"
    | "showImageInfo"
    | "viewport"
  >
>;
export type AtlasProjectCatalog = {
  projects: AtlasCanvasProject[];
  deletedProjects: AtlasDeletedProject[];
};

const DEFAULT_VIEWPORT: ViewportTransform = { x: 0, y: 0, k: 1 };

function cloneSnapshot<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizedTitle(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizedViewport(value: unknown): ViewportTransform {
  if (!value || typeof value !== "object") return { ...DEFAULT_VIEWPORT };
  const candidate = value as Partial<ViewportTransform>;
  return {
    x: Number.isFinite(candidate.x) ? Number(candidate.x) : 0,
    y: Number.isFinite(candidate.y) ? Number(candidate.y) : 0,
    k: Number.isFinite(candidate.k) && Number(candidate.k) > 0
      ? Math.min(5, Math.max(0.05, Number(candidate.k)))
      : 1,
  };
}

export function createAtlasCanvasProject(
  id: string,
  title: string,
  now: string,
  untitledFallback: string,
): AtlasCanvasProject {
  return {
    id,
    title: normalizedTitle(title, untitledFallback),
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

export function importAtlasCanvasProject(
  source: Partial<AtlasCanvasProject>,
  id: string,
  now: string,
  fallbackTitle: string,
): AtlasCanvasProject {
  return {
    id,
    title: normalizedTitle(source.title, fallbackTitle),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : now,
    updatedAt: now,
    nodes: cloneSnapshot(Array.isArray(source.nodes) ? source.nodes : []),
    connections: cloneSnapshot(
      Array.isArray(source.connections) ? source.connections : [],
    ),
    chatSessions: cloneSnapshot(
      Array.isArray(source.chatSessions) ? source.chatSessions : [],
    ),
    activeChatId:
      typeof source.activeChatId === "string" ? source.activeChatId : null,
    backgroundMode: source.backgroundMode === "dots" ? "dots" : "lines",
    showImageInfo: source.showImageInfo === true,
    viewport: normalizedViewport(source.viewport),
  };
}

function replaceProject(
  projects: AtlasCanvasProject[],
  id: string,
  patch: Partial<AtlasCanvasProject>,
  updatedAt: string,
): AtlasCanvasProject[] {
  return projects.map((project) =>
    project.id === id ? { ...project, ...patch, updatedAt } : project,
  );
}

export function renameAtlasCanvasProject(
  projects: AtlasCanvasProject[],
  id: string,
  title: string,
  now: string,
): AtlasCanvasProject[] {
  const current = projects.find((project) => project.id === id);
  const nextTitle = normalizedTitle(title, current?.title ?? "");
  if (!current || nextTitle === current.title) return projects;
  return replaceProject(projects, id, { title: nextTitle }, now);
}

export function updateAtlasCanvasProject(
  projects: AtlasCanvasProject[],
  id: string,
  patch: AtlasProjectPatch,
  now: string,
): AtlasCanvasProject[] {
  const current = projects.find((project) => project.id === id);
  if (!current) return projects;
  const changed = Object.entries(patch).some(
    ([key, value]) => current[key as keyof AtlasCanvasProject] !== value,
  );
  return changed ? replaceProject(projects, id, patch, now) : projects;
}

export function deleteAtlasCanvasProjects(
  catalog: AtlasProjectCatalog,
  ids: readonly string[],
  now: string,
): AtlasProjectCatalog {
  const removing = new Set(ids.filter((id) => typeof id === "string" && id));
  if (!removing.size) return catalog;
  const tombstones = new Map(
    catalog.deletedProjects.map((item) => [item.id, item]),
  );
  for (const id of removing) tombstones.set(id, { id, deletedAt: now });
  return {
    projects: catalog.projects.filter((project) => !removing.has(project.id)),
    deletedProjects: [...tombstones.values()],
  };
}

export function replaceAtlasProjectCatalog(
  projects: AtlasCanvasProject[],
  deletedProjects: AtlasDeletedProject[],
): AtlasProjectCatalog {
  const latestById = new Map<string, AtlasDeletedProject>();
  for (const entry of deletedProjects) {
    const current = latestById.get(entry.id);
    if (!current || entry.deletedAt > current.deletedAt) {
      latestById.set(entry.id, entry);
    }
  }
  const normalizedTombstones = [...latestById.values()];
  const unchanged =
    normalizedTombstones.length === deletedProjects.length &&
    normalizedTombstones.every((item, index) => item === deletedProjects[index]);
  return {
    projects,
    deletedProjects: unchanged ? deletedProjects : normalizedTombstones,
  };
}
