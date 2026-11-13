import { describe, expect, it, vi } from "vitest";
import type { StateStorage, StorageValue } from "zustand/middleware";

import { createAtlasDebouncedStorage } from "@/atlas-engine/document/persist-storage";

type State = { projects: string[] };

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const storage: StateStorage = {
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => { values.set(key, value); }),
    removeItem: vi.fn(async (key) => { values.delete(key); }),
  };
  return { storage, values };
}

describe("Atlas debounced persistence", () => {
  it("coalesces rapid snapshots into the latest write", async () => {
    vi.useFakeTimers();
    try {
      const { storage, values } = memoryStorage();
      const persisted = createAtlasDebouncedStorage<State>(storage, undefined, 40);
      persisted.setItem("canvas", { version: 1, state: { projects: ["one"] } });
      persisted.setItem("canvas", { version: 1, state: { projects: ["two"] } });
      persisted.setItem("canvas", { version: 1, state: { projects: ["latest"] } });

      await vi.advanceTimersByTimeAsync(40);
      expect(storage.setItem).toHaveBeenCalledTimes(1);
      expect(JSON.parse(values.get("canvas")!).state.projects).toEqual(["latest"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes the newest snapshot and waits for the underlying write", async () => {
    let release!: () => void;
    let finished = false;
    const storage: StateStorage = {
      getItem: async () => null,
      setItem: async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        finished = true;
      },
      removeItem: async () => undefined,
    };
    const persisted = createAtlasDebouncedStorage<State>(storage, undefined, 60_000);
    persisted.setItem("canvas", { version: 1, state: { projects: ["old"] } });
    persisted.setItem("canvas", { version: 1, state: { projects: ["latest"] } });

    const flushing = persisted.flush();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(finished).toBe(false);
    release();
    await flushing;
    expect(finished).toBe(true);
  });

  it("skips a snapshot superseded before its queued write begins", async () => {
    const { storage, values } = memoryStorage();
    const persisted = createAtlasDebouncedStorage<State>(storage, undefined, 60_000);
    persisted.setItem("canvas", { version: 1, state: { projects: ["stale"] } });
    const firstFlush = persisted.flush();
    persisted.setItem("canvas", { version: 1, state: { projects: ["fresh"] } });
    const secondFlush = persisted.flush();
    await Promise.all([firstFlush, secondFlush]);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(values.get("canvas")!).state.projects).toEqual(["fresh"]);
  });

  it("reads legacy data and removes its key only after a successful migration write", async () => {
    const old: StorageValue<State> = { version: 0, state: { projects: ["legacy"] } };
    const { storage, values } = memoryStorage({ oldKey: JSON.stringify(old) });
    let fail = true;
    const originalSet = storage.setItem;
    storage.setItem = vi.fn(async (key, value) => {
      if (fail) throw new Error("disk unavailable");
      await originalSet(key, value);
    });
    const persisted = createAtlasDebouncedStorage<State>(storage, "oldKey", 60_000);
    await expect(persisted.getItem("currentKey")).resolves.toEqual(old);

    persisted.setItem("currentKey", { version: 1, state: { projects: ["migrated"] } });
    await expect(persisted.flush()).rejects.toThrow("disk unavailable");
    expect(values.has("oldKey")).toBe(true);

    fail = false;
    persisted.setItem("currentKey", { version: 1, state: { projects: ["migrated"] } });
    await persisted.flush();
    expect(JSON.parse(values.get("currentKey")!).state.projects).toEqual(["migrated"]);
    expect(values.has("oldKey")).toBe(false);
  });

  it("serializes an in-flight write before a clear so cleared data cannot return", async () => {
    let releaseWrite!: () => void;
    const operations: string[] = [];
    const storage: StateStorage = {
      getItem: async () => null,
      setItem: async (key, value) => {
        await new Promise<void>((resolve) => { releaseWrite = resolve; });
        operations.push(`${key}:${value}`);
      },
      removeItem: async (key) => { operations.push(`remove:${key}`); },
    };
    const persisted = createAtlasDebouncedStorage<State>(storage, undefined, 0);
    persisted.setItem("canvas", { version: 1, state: { projects: ["queued"] } });
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf("function"));
    const clearing = persisted.removeItem("canvas");
    releaseWrite();
    await clearing;
    expect(operations.map((item) => item.split(":")[0])).toEqual(["canvas", "remove"]);
  });
});
