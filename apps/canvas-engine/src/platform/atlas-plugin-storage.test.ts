import { beforeEach, describe, expect, it, vi } from "vitest";

const { createScopedStorage } = vi.hoisted(() => ({
  createScopedStorage: vi.fn(),
}));
vi.mock("@/lib/localforage-storage", () => ({ createScopedStorage }));

function memoryStore() {
  const values = new Map<string, unknown>();
  return {
    values,
    getItem: vi.fn(async (key: string) =>
      structuredClone(values.get(key) ?? null),
    ),
    setItem: vi.fn(async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
      return value;
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Atlas plugin persistence", () => {
  const databases = new Map<string, ReturnType<typeof memoryStore>>();
  const database = (name: string) => {
    let store = databases.get(name);
    if (!store) {
      store = memoryStore();
      databases.set(name, store);
    }
    return store;
  };

  beforeEach(() => {
    vi.resetModules();
    databases.clear();
    createScopedStorage.mockReset().mockImplementation(database);
  });

  it("isolates colliding legacy names and compound owner/key boundaries", async () => {
    const { createAtlasPluginStorage: storage } =
      await import("@/atlas-engine/plugins/storage");
    const owners = ["a-b", "a_b", "a.b", "中文", 'x\",\"y', "x"];
    await Promise.all(
      owners.map((owner) => storage(owner).set("same-key", owner)),
    );
    expect(
      await Promise.all(owners.map((owner) => storage(owner).get("same-key"))),
    ).toEqual(owners);
    await storage("x").set('y\",\"same-key', "different boundary");
    expect(await storage('x\",\"y').get("same-key")).toBe('x\",\"y');
  });

  it("persists structured values across new adapters and module reloads", async () => {
    const first = await import("@/atlas-engine/plugins/storage");
    const value = { nested: [1, "two"], enabled: false };
    await first.createAtlasPluginStorage("demo").set("options", value);
    value.nested.push(3);
    vi.resetModules();
    const second = await import("@/atlas-engine/plugins/storage");
    expect(
      await second.createAtlasPluginStorage("demo").get("options"),
    ).toEqual({ nested: [1, "two"], enabled: false });
  });

  it("orders reads, writes and removals across adapters while other owners progress", async () => {
    const { createAtlasPluginStorage: storage } =
      await import("@/atlas-engine/plugins/storage");
    const store = database("atlas_plugin_entries_v1");
    const started = deferred();
    const release = deferred();
    const write = store.setItem.getMockImplementation()!;
    store.setItem.mockImplementationOnce(async (key, value) => {
      started.resolve();
      await release.promise;
      return write(key, value);
    });
    const firstWrite = storage("demo").set("key", "first");
    const firstRead = storage("demo").get("key");
    const removal = storage("demo").remove("key");
    const removedRead = storage("demo").get("key");
    const finalWrite = storage("demo").set("key", "last");
    const finalRead = storage("demo").get("key");
    await started.promise;
    await storage("unrelated").set("key", "independent");
    expect(await storage("unrelated").get("key")).toBe("independent");
    release.resolve();
    await Promise.all([firstWrite, removal, finalWrite]);
    expect(await firstRead).toBe("first");
    expect(await removedRead).toBeNull();
    expect(await finalRead).toBe("last");
  });

  it("reports failed operations without blocking later operations", async () => {
    const { createAtlasPluginStorage: storage } =
      await import("@/atlas-engine/plugins/storage");
    const store = database("atlas_plugin_entries_v1");
    store.setItem.mockRejectedValueOnce(new Error("disk full"));
    const failedWrite = storage("demo").set("key", "lost");
    const recoveredWrite = storage("demo").set("key", "saved");
    await expect(failedWrite).rejects.toThrow("disk full");
    await recoveredWrite;
    store.getItem.mockRejectedValueOnce(new Error("read failed"));
    await expect(storage("demo").get("key")).rejects.toThrow("read failed");
    expect(await storage("demo").get("key")).toBe("saved");
    store.setItem.mockRejectedValueOnce(new Error("delete failed"));
    await expect(storage("demo").remove("key")).rejects.toThrow(
      "delete failed",
    );
    expect(await storage("demo").get("key")).toBe("saved");
    await storage("demo").remove("key");
    expect(await storage("demo").get("key")).toBeNull();
  });

  it("migrates only unambiguous legacy namespaces and does not resurrect deletions", async () => {
    database("plugin_demo").values.set("options", { legacy: true });
    database("plugin_a_b").values.set("options", "unknown owner");
    const { createAtlasPluginStorage: storage } =
      await import("@/atlas-engine/plugins/storage");
    expect(await storage("demo").get("options")).toEqual({ legacy: true });
    database("plugin_demo").values.set("options", "obsolete");
    expect(await storage("demo").get("options")).toEqual({ legacy: true });
    await storage("demo").remove("options");
    vi.resetModules();
    const reloaded = await import("@/atlas-engine/plugins/storage");
    expect(
      await reloaded.createAtlasPluginStorage("demo").get("options"),
    ).toBeNull();
    for (const owner of ["a-b", "a_b", "a.b"]) {
      expect(await storage(owner).get("options")).toBeNull();
      await storage(owner).set("options", owner);
      await storage(owner).remove("options");
      expect(await storage(owner).get("options")).toBeNull();
    }
    expect(database("plugin_a_b").getItem).not.toHaveBeenCalled();
  });

  it("preserves explicit null without falling back to old data", async () => {
    database("plugin_demo").values.set("key", "obsolete");
    const { createAtlasPluginStorage: storage } =
      await import("@/atlas-engine/plugins/storage");
    await storage("demo").set("key", null);
    expect(await storage("demo").get("key")).toBeNull();
    expect(database("plugin_demo").getItem).not.toHaveBeenCalled();
  });
});
