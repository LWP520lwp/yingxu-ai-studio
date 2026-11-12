import type { StateStorage } from "zustand/middleware";
import type { PersistStorage, StorageValue } from "zustand/middleware";

export type DebouncedPersistStorage<S> = PersistStorage<S> & {
  flush: () => Promise<void>;
};

export function createDebouncedPersistStorage<S>(
  storage: StateStorage,
  legacyKey?: string,
  delayMs = 400,
): DebouncedPersistStorage<S> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; serialized: string; revision: number } | null = null;
  let revision = 0;
  let legacyRead = false;
  let writeChain: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>) => {
    writeChain = writeChain.catch(() => undefined).then(task);
    return writeChain;
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const item = pending;
    pending = null;
    if (!item) return writeChain;
    return enqueue(async () => {
      if (item.revision !== revision) return;
      await storage.setItem(item.name, item.serialized);
      if (legacyRead && legacyKey) {
        await storage.removeItem(legacyKey);
        legacyRead = false;
      }
    });
  };

  return {
    async getItem(name) {
      const current = await storage.getItem(name);
      if (current !== null) return JSON.parse(current) as StorageValue<S>;
      if (!legacyKey) return null;
      const legacy = await storage.getItem(legacyKey);
      legacyRead = legacy !== null;
      return legacy === null ? null : JSON.parse(legacy) as StorageValue<S>;
    },
    setItem(name, value: StorageValue<S>) {
      revision += 1;
      pending = { name, serialized: JSON.stringify(value), revision };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void flush().catch(() => undefined);
      }, delayMs);
    },
    removeItem(name) {
      revision += 1;
      pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return enqueue(async () => {
        await storage.removeItem(name);
        if (legacyKey) await storage.removeItem(legacyKey);
        legacyRead = false;
      });
    },
    flush,
  };
}
