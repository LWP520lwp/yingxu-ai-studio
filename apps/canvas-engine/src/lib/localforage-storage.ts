import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

let storageScope: string | null = null;
let resolveScope: (scope: string) => void;
const scopeReady = new Promise<string>((resolve) => { resolveScope = resolve; });
const instances = new Map<string, ReturnType<typeof localforage.createInstance>>();

/** Each embedded editor has one immutable owner/project scope. */
export function configureStorageScope(userId: string, projectId: string) {
    if (!userId || !projectId) throw new Error("画布存储缺少用户或项目标识");
    const scope = `${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
    if (storageScope && storageScope !== scope) throw new Error("切换项目时需要重新打开画布");
    storageScope = scope;
    resolveScope(scope);
}

async function scopedInstance(storeName: string) {
    const scope = await scopeReady;
    const key = `${scope}:${storeName}`;
    if (!instances.has(key)) instances.set(key, localforage.createInstance({
        name: `yingxu-atlas-canvas:${scope}`, storeName,
    }));
    return instances.get(key)!;
}

export function createScopedStorage(storeName: string) {
    return {
        async getItem<T>(key: string) { return (await scopedInstance(storeName)).getItem<T>(key); },
        async setItem<T>(key: string, value: T) { return (await scopedInstance(storeName)).setItem(key, value); },
        async removeItem(key: string) { return (await scopedInstance(storeName)).removeItem(key); },
        async clear() { return (await scopedInstance(storeName)).clear(); },
        async iterate<T, U>(iterator: (value: T, key: string, iterationNumber: number) => U) {
            return (await scopedInstance(storeName)).iterate(iterator);
        },
    };
}

const appState = createScopedStorage("app_state");
async function fallbackKey(name: string) {
    return `yingxu:atlas-canvas:${await scopeReady}:${name}`;
}

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await appState.getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(await fallbackKey(name));
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await appState.setItem(name, value);
        } catch {
            window.localStorage.setItem(await fallbackKey(name), value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await appState.removeItem(name);
        } catch {
            window.localStorage.removeItem(await fallbackKey(name));
        }
    },
};
