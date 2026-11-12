import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";

import i18n from "@/i18n";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";
import { localForageStorage } from "@/lib/localforage-storage";
import { createDebouncedPersistStorage } from "@/lib/canvas/canvas-persist-storage";
import { randomId } from "@/lib/utils";
import type {
  CanvasAssistantSession,
  CanvasConnection,
  CanvasNodeData,
  ViewportTransform,
} from "@/types/canvas";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";

/** The persisted catalog owned by the Frameflow workspace. */
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

type CanvasCatalog = {
  projects: CanvasProject[];
  deletedProjects: CanvasDeletedProject[];
};

type CanvasStore = CanvasCatalog & {
  hydrated: boolean;
  createProject: (title?: string) => string;
  importProject: (project: Partial<CanvasProject>) => string;
  openProject: (id: string) => CanvasProject | null;
  renameProject: (id: string, title: string) => void;
  deleteProjects: (ids: string[]) => void;
  replaceProjects: (
    projects: CanvasProject[],
    deletedProjects?: CanvasDeletedProject[],
  ) => void;
  updateProject: (id: string, patch: CanvasProjectPatch) => void;
};

const CANVAS_STORE_KEY = "yingxu-atlas:canvas_store:v2";
const DEFAULT_VIEWPORT: ViewportTransform = { x: 0, y: 0, k: 1 };

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeTitle(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeViewport(value: unknown): ViewportTransform {
  if (!value || typeof value !== "object") return { ...DEFAULT_VIEWPORT };
  const candidate = value as Partial<ViewportTransform>;
  return {
    x: Number.isFinite(candidate.x) ? Number(candidate.x) : 0,
    y: Number.isFinite(candidate.y) ? Number(candidate.y) : 0,
    k: Number.isFinite(candidate.k) && Number(candidate.k) > 0 ? Number(candidate.k) : 1,
  };
}

function newProject(id: string, title: string, now: string): CanvasProject {
  return {
    id,
    title: safeTitle(title, i18n.t("canvas.project.untitled")),
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

function importSnapshot(
  source: Partial<CanvasProject>,
  id: string,
  now: string,
): CanvasProject {
  return {
    id,
    title: safeTitle(source.title, i18n.t("canvas.project.imported")),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : now,
    updatedAt: now,
    nodes: clone(Array.isArray(source.nodes) ? source.nodes : []),
    connections: clone(Array.isArray(source.connections) ? source.connections : []),
    chatSessions: clone(Array.isArray(source.chatSessions) ? source.chatSessions : []),
    activeChatId: typeof source.activeChatId === "string" ? source.activeChatId : null,
    backgroundMode: source.backgroundMode === "dots" ? "dots" : "lines",
    showImageInfo: source.showImageInfo === true,
    viewport: safeViewport(source.viewport),
  };
}

function replaceOne<T extends { id: string }>(items: T[], id: string, patch: Partial<T>): T[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function touchProject(
  projects: CanvasProject[],
  id: string,
  patch: CanvasProjectPatch,
  now: string,
): CanvasProject[] {
  const current = projects.find((project) => project.id === id);
  if (!current) return projects;
  const changed = Object.keys(patch).some((key) => {
    const field = key as keyof CanvasProjectPatch;
    return current[field] !== patch[field];
  });
  return changed ? replaceOne(projects, id, { ...patch, updatedAt: now }) : projects;
}

function removeProjects(catalog: CanvasCatalog, ids: string[], now: string): CanvasCatalog {
  const wanted = new Set(ids.filter((id) => typeof id === "string" && id.length > 0));
  if (!wanted.size) return catalog;
  const tombstones = new Map(catalog.deletedProjects.map((item) => [item.id, item]));
  wanted.forEach((id) => tombstones.set(id, { id, deletedAt: now }));
  return {
    projects: catalog.projects.filter((project) => !wanted.has(project.id)),
    deletedProjects: [...tombstones.values()],
  };
}

function mergeCatalog(projects: CanvasProject[], deletedProjects: CanvasDeletedProject[]): CanvasCatalog {
  const latest = new Map<string, CanvasDeletedProject>();
  for (const entry of deletedProjects) {
    const current = latest.get(entry.id);
    if (!current || entry.deletedAt > current.deletedAt) latest.set(entry.id, entry);
  }
  return { projects, deletedProjects: [...latest.values()] };
}

const canvasStorage = createDebouncedPersistStorage<CanvasStore>(
  localForageStorage,
  LEGACY_STORAGE_KEYS.canvas,
  400,
);

export const useCanvasStore = create<CanvasStore>()(
  persist(
    (set, get) => ({
      hydrated: false,
      projects: [],
      deletedProjects: [],
      createProject: (title) => {
        const now = new Date().toISOString();
        const project = newProject(randomId(), title ?? i18n.t("canvas.project.untitled"), now);
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
      },
      importProject: (source) => {
        const now = new Date().toISOString();
        const project = importSnapshot(source, randomId(), now);
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
      },
      openProject: (id) => get().projects.find((project) => project.id === id) ?? null,
      renameProject: (id, title) =>
        set((state) => {
          const current = state.projects.find((project) => project.id === id);
          const nextTitle = safeTitle(title, current?.title ?? "");
          return current && nextTitle !== current.title
            ? { projects: replaceOne(state.projects, id, { title: nextTitle, updatedAt: new Date().toISOString() }) }
            : state;
        }),
      deleteProjects: (ids) =>
        set((state) => removeProjects(state, ids, new Date().toISOString())),
      replaceProjects: (projects, deletedProjects = []) =>
        set((state) => {
          const next = mergeCatalog(projects, deletedProjects);
          return next.projects === state.projects && next.deletedProjects === state.deletedProjects
            ? state
            : next;
        }),
      updateProject: (id, patch) =>
        set((state) => ({ projects: touchProject(state.projects, id, patch, new Date().toISOString()) })),
    }),
    {
      name: CANVAS_STORE_KEY,
      skipHydration: true,
      storage: canvasStorage,
      partialize: (state) =>
        ({ projects: state.projects, deletedProjects: state.deletedProjects }) as StorageValue<CanvasStore>["state"],
      onRehydrateStorage: () => () => {
        useCanvasStore.setState({ hydrated: true });
      },
    },
  ),
);
