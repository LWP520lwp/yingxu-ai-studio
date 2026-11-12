import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

type StorageInstance = ReturnType<typeof localforage.createInstance>;

class ProjectStorageScope {
  readonly key: string;
  private readonly databases = new Map<string, StorageInstance>();

  constructor(userId: string, projectId: string) {
    this.key = `${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
  }

  get databaseName() {
    return `yingxu-atlas-canvas:${this.key}`;
  }

  get fallbackPrefix() {
    return `yingxu:atlas-canvas:${this.key}:`;
  }

  async store(name: string) {
    let database = this.databases.get(name);
    if (!database) {
      database = localforage.createInstance({
        name: this.databaseName,
        storeName: name,
      });
      this.databases.set(name, database);
    }
    return database;
  }
}

let configuredScope: ProjectStorageScope | undefined;
let resolveConfiguredScope!: (scope: ProjectStorageScope) => void;
const scopeReady = new Promise<ProjectStorageScope>((resolve) => {
  resolveConfiguredScope = resolve;
});

function requireProjectScope(userId: string, projectId: string) {
  if (!userId.trim() || !projectId.trim()) {
    throw new Error("画布存储缺少用户或项目标识");
  }
  return new ProjectStorageScope(userId, projectId);
}

/** A mounted editor stays bound to one account/project database. */
export function configureStorageScope(userId: string, projectId: string) {
  const next = requireProjectScope(userId, projectId);
  if (configuredScope && configuredScope.key !== next.key) {
    throw new Error("切换项目时需要重新打开画布");
  }
  if (!configuredScope) {
    configuredScope = next;
    resolveConfiguredScope(next);
  }
}

export async function getCurrentStorageDatabaseName() {
  return (await scopeReady).databaseName;
}

export function createScopedStorage(storeName: string) {
  const store = async () => (await scopeReady).store(storeName);
  return {
    getItem: async <T>(key: string) => (await store()).getItem<T>(key),
    setItem: async <T>(key: string, value: T) =>
      (await store()).setItem(key, value),
    removeItem: async (key: string) => (await store()).removeItem(key),
    clear: async () => (await store()).clear(),
    iterate: async <T, U>(
      iterator: (value: T, key: string, iterationNumber: number) => U,
    ) => (await store()).iterate(iterator),
  };
}

const persistedState = createScopedStorage("app_state");

async function fallbackStorageKey(name: string) {
  const scope = await scopeReady;
  return `${scope.fallbackPrefix}${name}`;
}

export const localForageStorage: StateStorage = {
  getItem: async (name) => {
    if (typeof window === "undefined") return null;
    try {
      return (await persistedState.getItem<string>(name)) ?? null;
    } catch {
      return window.localStorage.getItem(await fallbackStorageKey(name));
    }
  },
  setItem: async (name, value) => {
    if (typeof window === "undefined") return;
    try {
      await persistedState.setItem(name, value);
    } catch {
      window.localStorage.setItem(await fallbackStorageKey(name), value);
    }
  },
  removeItem: async (name) => {
    if (typeof window === "undefined") return;
    try {
      await persistedState.removeItem(name);
    } catch {
      window.localStorage.removeItem(await fallbackStorageKey(name));
    }
  },
};

/** Reads a legacy key once while directing all later mutations to the new key. */
export function createMigratingStorage(legacyKey: string): StateStorage {
  return {
    getItem: async (name) => {
      const current = await localForageStorage.getItem(name);
      return current ?? localForageStorage.getItem(legacyKey);
    },
    setItem: (name, value) => localForageStorage.setItem(name, value),
    removeItem: (name) => localForageStorage.removeItem(name),
  };
}
