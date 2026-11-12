import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";

import i18n from "@/i18n";
import { randomId } from "@/lib/utils";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";
import { localForageStorage } from "@/lib/localforage-storage";
import { createDebouncedPersistStorage } from "@/lib/canvas/canvas-persist-storage";
import {
    createCanvasProject,
    deleteCanvasProjects,
    importCanvasProject,
    renameCanvasProject,
    replaceCanvasCatalog,
    updateCanvasProject,
    type CanvasDeletedProject,
    type CanvasProjectPatch,
    type CanvasProject,
} from "@/lib/canvas/canvas-project-catalog";

export type { CanvasProject, CanvasDeletedProject };

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: CanvasProjectPatch) => void;
};

const CANVAS_STORE_KEY = "yingxu-atlas:canvas_store:v2";
const canvasStorage = createDebouncedPersistStorage<CanvasStore>(localForageStorage, LEGACY_STORAGE_KEYS.canvas, 400);

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = randomId();
                const project = createCanvasProject(id, title, now);
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project = importCanvasProject(source, randomId(), now, i18n.t("canvas.project.imported"));
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) => set((state) => {
                const projects = renameCanvasProject(state.projects, id, title, new Date().toISOString());
                return projects === state.projects ? state : { projects };
            }),
            deleteProjects: (ids) =>
                set((state) => {
                    const next = deleteCanvasProjects(state, ids, new Date().toISOString());
                    return next === state ? state : next;
                }),
            replaceProjects: (projects, deletedProjects = []) => set((state) => {
                const next = replaceCanvasCatalog(projects, deletedProjects);
                if (next.projects === state.projects && next.deletedProjects === state.deletedProjects) return state;
                return next;
            }),
            updateProject: (id, patch) => set((state) => {
                const projects = updateCanvasProject(state.projects, id, patch, new Date().toISOString());
                return projects === state.projects ? state : { projects };
            }),
        }),
        {
            name: CANVAS_STORE_KEY,
            // The parent loads the authoritative project before the canvas is mounted.
            skipHydration: true,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
