import type { StateStorage } from "zustand/middleware";
import type { PersistStorage, StorageValue } from "zustand/middleware";

export type AtlasDebouncedStorage<S> = PersistStorage<S> & {
  flush: () => Promise<void>;
};

type PendingWrite = Readonly<{
  key: string;
  payload: string;
  revision: number;
}>;

/** Coalesces snapshots while preserving write, migration, and clear ordering. */
export function createAtlasDebouncedStorage<S>(
  storage: StateStorage,
  legacyKey?: string,
  delayMs = 400,
): AtlasDebouncedStorage<S> {
  const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 400;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PendingWrite | null = null;
  let revision = 0;
  let legacyNeedsCleanup = false;
  let writeQueue: Promise<void> = Promise.resolve();

  const enqueue = (operation: () => Promise<void>) => {
    const next = writeQueue.catch(() => undefined).then(operation);
    writeQueue = next;
    return next;
  };

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = (): Promise<void> => {
    cancelTimer();
    const write = pending;
    pending = null;
    if (!write) return writeQueue;

    return enqueue(async () => {
      if (write.revision !== revision) return;
      await storage.setItem(write.key, write.payload);
      if (legacyNeedsCleanup && legacyKey) {
        await storage.removeItem(legacyKey);
        legacyNeedsCleanup = false;
      }
    });
  };

  return {
    async getItem(key) {
      const current = await storage.getItem(key);
      if (current !== null) return JSON.parse(current) as StorageValue<S>;
      if (!legacyKey) return null;
      const legacy = await storage.getItem(legacyKey);
      legacyNeedsCleanup = legacy !== null;
      return legacy === null ? null : (JSON.parse(legacy) as StorageValue<S>);
    },
    setItem(key, value) {
      const payload = JSON.stringify(value);
      if (payload === undefined) {
        throw new TypeError("画布持久化快照不能序列化为 undefined");
      }
      const writeRevision = ++revision;
      pending = { key, payload, revision: writeRevision };
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        void flush().catch(() => undefined);
      }, delay);
    },
    removeItem(key) {
      revision += 1;
      pending = null;
      cancelTimer();
      return enqueue(async () => {
        await storage.removeItem(key);
        if (legacyKey) await storage.removeItem(legacyKey);
        legacyNeedsCleanup = false;
      });
    },
    flush,
  };
}

export const createDebouncedPersistStorage = createAtlasDebouncedStorage;
export type DebouncedPersistStorage<S> = AtlasDebouncedStorage<S>;
