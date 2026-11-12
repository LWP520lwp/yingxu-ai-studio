import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createMigratingStorage } from "@/lib/localforage-storage";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

const DEFAULT_THEME: ThemeName = "dark";
const THEME_STORAGE_KEY = "yingxu-atlas:theme_store:v2";

function restoreTheme(value: unknown, fallback: ThemeName): ThemeName {
    if (value === "light" || value === "dark") return value;
    return fallback;
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: DEFAULT_THEME,
            setTheme: (theme) => set({ theme: restoreTheme(theme, DEFAULT_THEME) }),
        }),
        {
            name: THEME_STORAGE_KEY,
            storage: createJSONStorage(() => createMigratingStorage(LEGACY_STORAGE_KEYS.theme)),
            merge: (persisted, current) => {
                const saved = persisted as Partial<ThemeStore> | null;
                return { ...current, theme: restoreTheme(saved?.theme, current.theme) };
            },
        },
    ),
);
