import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";

import i18n from "@/i18n";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";
import { localForageStorage } from "@/lib/localforage-storage";
import { createDebouncedPersistStorage } from "@/atlas-engine/document/persist-storage";
import { randomId } from "@/lib/utils";
import {
  createAtlasCanvasProject,
  deleteAtlasCanvasProjects,
  importAtlasCanvasProject,
  renameAtlasCanvasProject,
  replaceAtlasProjectCatalog,
  updateAtlasCanvasProject,
  type AtlasCanvasProject,
  type AtlasDeletedProject,
  type AtlasProjectCatalog,
  type AtlasProjectPatch,
} from "@/atlas-engine/document/project-catalog";

export type CanvasProject = AtlasCanvasProject;
export type CanvasDeletedProject = AtlasDeletedProject;
export type CanvasProjectPatch = AtlasProjectPatch;

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
type CanvasCatalog = AtlasProjectCatalog;

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
        const untitled = i18n.t("canvas.project.untitled");
        const project = createAtlasCanvasProject(
          randomId(),
          title ?? untitled,
          now,
          untitled,
        );
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
      },
      importProject: (source) => {
        const now = new Date().toISOString();
        const project = importAtlasCanvasProject(
          source,
          randomId(),
          now,
          i18n.t("canvas.project.imported"),
        );
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
      },
      openProject: (id) => get().projects.find((project) => project.id === id) ?? null,
      renameProject: (id, title) =>
        set((state) => {
          const projects = renameAtlasCanvasProject(
            state.projects,
            id,
            title,
            new Date().toISOString(),
          );
          return projects === state.projects ? state : { projects };
        }),
      deleteProjects: (ids) =>
        set((state) =>
          deleteAtlasCanvasProjects(state, ids, new Date().toISOString()),
        ),
      replaceProjects: (projects, deletedProjects = []) =>
        set((state) => {
          const next = replaceAtlasProjectCatalog(projects, deletedProjects);
          return next.projects === state.projects && next.deletedProjects === state.deletedProjects
            ? state
            : next;
        }),
      updateProject: (id, patch) =>
        set((state) => {
          const projects = updateAtlasCanvasProject(
            state.projects,
            id,
            patch,
            new Date().toISOString(),
          );
          return projects === state.projects ? state : { projects };
        }),
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
