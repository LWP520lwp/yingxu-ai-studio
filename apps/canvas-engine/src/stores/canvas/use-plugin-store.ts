import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createMigratingStorage } from "@/lib/localforage-storage";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";
import {
  removePluginInstallation,
  restorePluginInstallations,
  setPluginInstallationEnabled,
  upsertPluginInstallation,
  type InstalledPlugin,
  type PluginInstallInput,
} from "@/lib/plugin-install-catalog";

export type { InstalledPlugin } from "@/lib/plugin-install-catalog";

const STORE_KEY = "yingxu-atlas:plugin_store:v2";

type PluginStore = {
  plugins: InstalledPlugin[];
  upsert: (plugin: PluginInstallInput) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  remove: (id: string) => void;
};

export const usePluginStore = create<PluginStore>()(
  persist(
    (set) => ({
      plugins: [],
      upsert: (plugin) => set((state) => ({
        plugins: upsertPluginInstallation(state.plugins, plugin),
      })),
      setEnabled: (id, enabled) => set((state) => ({
        plugins: setPluginInstallationEnabled(state.plugins, id, enabled),
      })),
      remove: (id) => set((state) => ({
        plugins: removePluginInstallation(state.plugins, id),
      })),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => createMigratingStorage(LEGACY_STORAGE_KEYS.plugins)),
      partialize: ({ plugins }) => ({ plugins }),
      merge: (saved, current) => ({
        ...current,
        plugins: restorePluginInstallations((saved as Partial<PluginStore> | null)?.plugins),
      }),
    },
  ),
);
