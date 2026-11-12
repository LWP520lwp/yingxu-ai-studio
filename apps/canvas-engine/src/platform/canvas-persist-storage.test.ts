import { describe, expect, it, vi } from "vitest";
import type { StateStorage, StorageValue } from "zustand/middleware";

import { createDebouncedPersistStorage } from "@/lib/canvas/canvas-persist-storage";

type State = { projects: string[] };

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const storage: StateStorage = {
    getItem: vi.fn(async (name) => values.get(name) ?? null),
    setItem: vi.fn(async (name, value) => { values.set(name, value); }),
    removeItem: vi.fn(async (name) => { values.delete(name); }),
  };
  return { storage, values };
}

describe("canvas persist storage", () => {
  it("reads legacy state and migrates it on the next persisted write", async () => {
    const old: StorageValue<State> = { version: 0, state: { projects: ["legacy"] } };
    const { storage, values } = memoryStorage({ oldKey: JSON.stringify(old) });
    const persisted = createDebouncedPersistStorage<State>(storage, "oldKey", 60_000);
    await expect(persisted.getItem("currentKey")).resolves.toEqual(old);

    persisted.setItem("currentKey", { version: 1, state: { projects: ["migrated"] } });
    await persisted.flush();
    expect(JSON.parse(values.get("currentKey")!)).toEqual({ version: 1, state: { projects: ["migrated"] } });
    expect(values.has("oldKey")).toBe(false);
  });

  it("cancels a queued debounced write when storage is cleared", async () => {
    vi.useFakeTimers();
    try {
      const { storage, values } = memoryStorage();
      const persisted = createDebouncedPersistStorage<State>(storage, "oldKey", 100);
      persisted.setItem("currentKey", { version: 1, state: { projects: ["stale"] } });
      await persisted.removeItem("currentKey");
      await vi.advanceTimersByTimeAsync(200);

      expect(storage.setItem).not.toHaveBeenCalled();
      expect(values.has("currentKey")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes an in-flight write before a clear so cleared data cannot return", async () => {
    let releaseWrite!: () => void;
    const writes: string[] = [];
    const storage: StateStorage = {
      getItem: async () => null,
      setItem: async (name, value) => {
        await new Promise<void>((resolve) => { releaseWrite = resolve; });
        writes.push(`${name}:${value}`);
      },
      removeItem: async (name) => { writes.push(`remove:${name}`); },
    };
    const persisted = createDebouncedPersistStorage<State>(storage, undefined, 0);
    persisted.setItem("canvas", { version: 1, state: { projects: ["queued"] } });
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf("function"));
    const clearing = persisted.removeItem("canvas");
    releaseWrite();
    await clearing;
    expect(writes.map((item) => item.split(":")[0])).toEqual(["canvas", "remove"]);
  });
});
