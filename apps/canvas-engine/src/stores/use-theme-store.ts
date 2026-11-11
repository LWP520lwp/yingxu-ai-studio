import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createMigratingStorage } from "@/lib/localforage-storage";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            setTheme: (theme) => set({ theme }),
        }),
        { name: "yingxu-atlas:theme_store:v2", storage: createJSONStorage(() => createMigratingStorage("infinite-canvas:theme_store")) },
    ),
);
