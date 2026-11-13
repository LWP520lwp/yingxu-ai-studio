import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activatePlugin,
  createAtlasPluginLoader,
  deactivatePlugin,
  replaceActivePlugin,
} from "@/atlas-engine/plugins/loader";
import type { CanvasPlugin } from "@/types/canvas-plugin";
import type { InstalledPlugin } from "@/stores/canvas/use-plugin-store";

const { registerNodeDefinitions, unregisterPluginNodes, injectCSS } =
  vi.hoisted(() => ({
    registerNodeDefinitions: vi.fn(),
    unregisterPluginNodes: vi.fn(),
    injectCSS: vi.fn(() => vi.fn()),
  }));
const testLoaders: Array<ReturnType<typeof createAtlasPluginLoader>> = [];

vi.mock("@/atlas-engine/model/node-registry", () => ({
  registerAtlasNodeDefinitions: registerNodeDefinitions,
  unregisterAtlasPluginNodes: unregisterPluginNodes,
}));
vi.mock("@/atlas-engine/plugins/runtime", () => ({
  getAtlasPluginRuntime: () => ({ injectCSS }),
}));
vi.mock("@/stores/canvas/use-plugin-store", () => ({
  usePluginStore: { getState: () => ({}) },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

function plugin(overrides: Partial<CanvasPlugin> = {}): CanvasPlugin {
  return {
    id: "plugin-loader-test",
    name: "Test plugin",
    version: "1.0.0",
    nodes: [
      {
        type: "plugin-loader-test:node",
        title: "Node",
        icon: null,
        defaultSize: { width: 200, height: 100 },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  injectCSS.mockImplementation(() => vi.fn());
});

afterEach(() => {
  deactivatePlugin("plugin-loader-test");
  for (const loader of testLoaders) {
    loader.deactivatePlugin("plugin-loader-test");
  }
  testLoaders.length = 0;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("plugin loader activation", () => {
  it("rolls back node registration when setup fails", () => {
    const failure = new Error("setup failed");
    expect(() =>
      activatePlugin(
        plugin({
          css: ".test { color: red }",
          setup: () => {
            throw failure;
          },
        }),
      ),
    ).toThrow(failure);
    expect(registerNodeDefinitions).toHaveBeenCalledOnce();
    expect(injectCSS).toHaveBeenCalledOnce();
    expect(injectCSS.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(unregisterPluginNodes).toHaveBeenCalledWith("plugin-loader-test");
  });

  it("does not run setup twice for an already active plugin", () => {
    const setup = vi.fn();
    activatePlugin(plugin({ setup }));
    activatePlugin(plugin({ setup }));
    expect(setup).toHaveBeenCalledOnce();
    expect(registerNodeDefinitions).toHaveBeenCalledOnce();
  });

  it("runs disposers in reverse order and unregisters node definitions", () => {
    const order: string[] = [];
    const removeCss = vi.fn(() => order.push("css"));
    injectCSS.mockReturnValue(removeCss);
    activatePlugin(
      plugin({ css: ".test {}", setup: () => () => order.push("setup") }),
    );
    deactivatePlugin("plugin-loader-test");
    expect(order).toEqual(["setup", "css"]);
    expect(unregisterPluginNodes).toHaveBeenCalledWith("plugin-loader-test");
  });

  it("restores the active plugin when a replacement fails during setup", () => {
    const previousCleanup = vi.fn();
    const previousSetup = vi.fn(() => previousCleanup);
    activatePlugin(plugin({ version: "1.0.0", setup: previousSetup }));

    expect(() =>
      replaceActivePlugin(
        plugin({
          version: "2.0.0",
          css: ".new-version {}",
          setup: () => {
            throw new Error("replacement failed");
          },
        }),
      ),
    ).toThrow("replacement failed");

    expect(previousCleanup).toHaveBeenCalledOnce();
    expect(previousSetup).toHaveBeenCalledTimes(2);
    expect(registerNodeDefinitions).toHaveBeenCalledTimes(3);
    expect(unregisterPluginNodes).toHaveBeenCalledWith("plugin-loader-test");
  });

  it("rejects invalid node batches before registering any definitions", () => {
    const invalid = plugin({
      nodes: [
        {
          type: "plugin-loader-test:node",
          title: "Node",
          icon: null,
          defaultSize: { width: 200, height: 100 },
        },
        {
          type: "plugin-loader-test:node",
          title: "Duplicate",
          icon: null,
          defaultSize: { width: 200, height: 100 },
        },
      ],
    });

    expect(() => activatePlugin(invalid)).toThrow(
      "canvas.pluginErrors.invalidExport",
    );
    expect(registerNodeDefinitions).not.toHaveBeenCalled();
  });
});

function installed(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: "plugin-loader-test",
    name: "Test plugin",
    version: "1.0.0",
    url: "https://plugins.test/old.js",
    source: "old",
    enabled: true,
    installedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function loaderFixture(initial: InstalledPlugin[] = []) {
  let records = [...initial];
  const definitions = new Map<string, CanvasPlugin>();
  definitions.set("old", plugin());
  definitions.set("new", plugin({ version: "2.0.0" }));
  const store = {
    get plugins() {
      return records;
    },
    upsert: vi.fn(
      (
        value: Omit<InstalledPlugin, "installedAt"> & { installedAt?: string },
      ) => {
        records = [
          ...records.filter((item) => item.id !== value.id),
          {
            ...value,
            installedAt: value.installedAt ?? "2026-11-11T00:00:00.000Z",
          },
        ];
      },
    ),
    setEnabled: vi.fn((id: string, enabled: boolean) => {
      records = records.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      );
    }),
    remove: vi.fn((id: string) => {
      records = records.filter((item) => item.id !== id);
    }),
  };
  const dependencies = {
    getStore: () => store,
    rehydrate: vi.fn(async () => undefined),
    fetchSource: vi.fn(async (_url: string) => "new"),
    evaluateSource: vi.fn(async (source: string) => {
      const definition = definitions.get(source);
      if (!definition) throw new Error("missing source");
      return definition;
    }),
    readLocalIndex: vi.fn<() => Promise<unknown>>(async () => []),
    getRuntime: () => ({
      version: "test",
      emit: vi.fn(),
      on: () => vi.fn(),
      injectCSS,
    }),
    getOrigin: () => "https://studio.test",
    getDevSources: vi.fn<() => string | undefined>(() => undefined),
  };
  const loader = createAtlasPluginLoader({
    ...dependencies,
    getDevelopmentSources: dependencies.getDevSources,
  });
  testLoaders.push(loader);
  return { loader, dependencies, definitions, store };
}

describe("plugin installation transactions", () => {
  it("activates a downloaded plugin before persisting it and preserves its installation date", async () => {
    const fixture = loaderFixture([installed()]);
    const setup = vi.fn(() => {
      expect(fixture.store.upsert).not.toHaveBeenCalled();
    });
    fixture.definitions.set("new", plugin({ version: "2.0.0", setup }));

    await fixture.loader.installPluginFromUrl("https://plugins.test/new.js", {
      official: true,
    });

    expect(setup).toHaveBeenCalledOnce();
    expect(fixture.store.plugins).toMatchObject([
      {
        version: "2.0.0",
        source: "new",
        enabled: true,
        official: true,
        installedAt: "2026-11-01T00:00:00.000Z",
      },
    ]);
  });

  it("keeps the running version and persisted record when downloading fails", async () => {
    const fixture = loaderFixture([installed()]);
    const cleanup = vi.fn();
    fixture.loader.activatePlugin(plugin({ setup: () => cleanup }));
    fixture.dependencies.fetchSource.mockRejectedValue(new Error("offline"));

    await expect(fixture.loader.updatePlugin(installed())).rejects.toThrow(
      "offline",
    );

    expect(cleanup).not.toHaveBeenCalled();
    expect(fixture.store.plugins[0].version).toBe("1.0.0");
    expect(fixture.store.upsert).not.toHaveBeenCalled();
  });

  it("restores the running version when a downloaded replacement fails during setup", async () => {
    const fixture = loaderFixture([installed()]);
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    fixture.loader.activatePlugin(plugin({ setup }));
    fixture.definitions.set(
      "new",
      plugin({
        setup: () => {
          throw new Error("broken setup");
        },
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fixture.loader.updatePlugin(installed())).rejects.toThrow(
      "broken setup",
    );

    expect(cleanup).toHaveBeenCalledOnce();
    expect(setup).toHaveBeenCalledTimes(2);
    expect(fixture.store.plugins[0].version).toBe("1.0.0");
    expect(fixture.store.upsert).not.toHaveBeenCalled();
  });

  it("does not resurrect an uninstalled plugin while its cached fallback is being evaluated", async () => {
    const fixture = loaderFixture([installed()]);
    const fallback = deferred<CanvasPlugin>();
    const previousSetup = vi.fn();
    fixture.definitions.set(
      "new",
      plugin({
        setup: () => {
          throw new Error("broken setup");
        },
      }),
    );
    fixture.dependencies.evaluateSource.mockImplementation(async (source) =>
      source === "old" ? fallback.promise : fixture.definitions.get(source)!,
    );
    const installation = fixture.loader.updatePlugin(installed());
    const rejected = expect(installation).rejects.toThrow("broken setup");
    await vi.waitFor(() =>
      expect(fixture.dependencies.evaluateSource).toHaveBeenCalledWith("old"),
    );

    fixture.loader.uninstallPlugin("plugin-loader-test");
    fallback.resolve(plugin({ setup: previousSetup }));
    await rejected;

    expect(previousSetup).not.toHaveBeenCalled();
    expect(fixture.store.plugins).toEqual([]);
    expect(fixture.store.upsert).not.toHaveBeenCalled();
  });

  it("rejects an update that exports a different plugin identifier", async () => {
    const fixture = loaderFixture([installed()]);
    fixture.definitions.set("new", plugin({ id: "different-plugin" }));

    await expect(fixture.loader.updatePlugin(installed())).rejects.toThrow(
      "canvas.pluginErrors.invalidExport",
    );

    expect(registerNodeDefinitions).not.toHaveBeenCalled();
    expect(fixture.store.plugins[0].id).toBe("plugin-loader-test");
    expect(fixture.store.upsert).not.toHaveBeenCalled();
  });

  it("ignores an older download that finishes after a newer installation", async () => {
    const fixture = loaderFixture();
    const older = deferred<string>();
    fixture.dependencies.fetchSource.mockImplementation(async (url) =>
      url.endsWith("old.js") ? older.promise : "new",
    );
    const first = fixture.loader.installPluginFromUrl(
      "https://plugins.test/old.js",
    );
    const rejected = expect(first).rejects.toThrow("superseded");

    await fixture.loader.installPluginFromUrl("https://plugins.test/new.js");
    older.resolve("old");
    await rejected;

    expect(fixture.store.plugins[0].version).toBe("2.0.0");
    expect(fixture.store.upsert).toHaveBeenCalledOnce();
    expect(registerNodeDefinitions).toHaveBeenCalledOnce();
  });

  it("cannot enable an uninstalled record retained by an old UI snapshot", async () => {
    const fixture = loaderFixture();

    await expect(
      fixture.loader.setPluginEnabled(installed(), true),
    ).rejects.toThrow("superseded");

    expect(fixture.dependencies.evaluateSource).not.toHaveBeenCalled();
    expect(registerNodeDefinitions).not.toHaveBeenCalled();
  });

  it("keeps a plugin disabled when enable evaluation completes after disable", async () => {
    const fixture = loaderFixture([installed({ enabled: false })]);
    const pending = deferred<CanvasPlugin>();
    fixture.dependencies.evaluateSource.mockReturnValue(pending.promise);
    const enabling = fixture.loader.setPluginEnabled(installed(), true);
    const rejected = expect(enabling).rejects.toThrow("superseded");

    await fixture.loader.setPluginEnabled(installed(), false);
    pending.resolve(plugin());
    await rejected;

    expect(fixture.store.plugins[0].enabled).toBe(false);
    expect(registerNodeDefinitions).not.toHaveBeenCalled();
  });

  it("refreshes a local plugin cache only after the latest version is enabled successfully", async () => {
    const fixture = loaderFixture([installed({ local: true, enabled: false })]);

    await fixture.loader.setPluginEnabled(installed(), true);

    expect(fixture.store.plugins[0]).toMatchObject({
      source: "new",
      version: "2.0.0",
      local: true,
      enabled: true,
    });
    expect(
      new URL(
        fixture.dependencies.fetchSource.mock.calls[0][0],
      ).searchParams.has("_plugin_refresh"),
    ).toBe(true);
  });
});

describe("plugin startup recovery", () => {
  it("retries discovery failures without rehydrating or restarting healthy plugins", async () => {
    const fixture = loaderFixture([installed()]);
    const setup = vi.fn();
    fixture.definitions.set("old", plugin({ setup }));
    fixture.dependencies.readLocalIndex.mockRejectedValueOnce(new Error("503"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await Promise.all([
      fixture.loader.ensurePluginsLoaded(),
      fixture.loader.ensurePluginsLoaded(),
    ]);
    await fixture.loader.ensurePluginsLoaded();
    await fixture.loader.ensurePluginsLoaded();

    expect(fixture.dependencies.rehydrate).toHaveBeenCalledOnce();
    expect(fixture.dependencies.readLocalIndex).toHaveBeenCalledTimes(2);
    expect(setup).toHaveBeenCalledOnce();
  });

  it("retries a mismatched cached export instead of marking startup complete", async () => {
    const fixture = loaderFixture([installed()]);
    fixture.dependencies.evaluateSource.mockResolvedValueOnce(
      plugin({ id: "wrong-plugin" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await fixture.loader.ensurePluginsLoaded();
    expect(registerNodeDefinitions).not.toHaveBeenCalled();
    await fixture.loader.ensurePluginsLoaded();

    expect(fixture.dependencies.evaluateSource).toHaveBeenCalledTimes(2);
    expect(registerNodeDefinitions).toHaveBeenCalledOnce();
  });

  it("preserves local enablement and uses a single fresh download during startup", async () => {
    const fixture = loaderFixture([installed({ local: true })]);
    fixture.dependencies.readLocalIndex.mockResolvedValue([
      "/plugins/local.js",
      "/plugins/local.js",
    ]);

    await fixture.loader.ensurePluginsLoaded();

    expect(fixture.dependencies.fetchSource).toHaveBeenCalledOnce();
    expect(fixture.store.plugins[0]).toMatchObject({
      version: "2.0.0",
      source: "new",
      local: true,
      enabled: true,
      installedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(registerNodeDefinitions).toHaveBeenCalledOnce();
  });

  it("does not let bundled discovery replace an explicitly installed remote plugin", async () => {
    const fixture = loaderFixture([installed({ official: true })]);
    const bundledSetup = vi.fn();
    fixture.definitions.set(
      "new",
      plugin({ version: "2.0.0", setup: bundledSetup }),
    );
    fixture.dependencies.readLocalIndex.mockResolvedValue([
      "/plugins/local.js",
    ]);

    await fixture.loader.ensurePluginsLoaded();

    expect(fixture.store.plugins[0]).toMatchObject({
      version: "1.0.0",
      url: "https://plugins.test/old.js",
      official: true,
    });
    expect(fixture.store.upsert).not.toHaveBeenCalled();
    expect(bundledSetup).not.toHaveBeenCalled();
  });

  it("replaces a running local version when startup discovers updated source", async () => {
    const fixture = loaderFixture([installed({ local: true, source: "old" })]);
    const previousCleanup = vi.fn();
    const nextSetup = vi.fn();
    fixture.definitions.set(
      "old",
      plugin({ version: "1.0.0", setup: () => previousCleanup }),
    );
    fixture.definitions.set(
      "new",
      plugin({ version: "2.0.0", setup: nextSetup }),
    );
    fixture.dependencies.fetchSource.mockResolvedValueOnce("old");
    await fixture.loader.installPluginFromUrl("https://plugins.test/old.js");
    fixture.dependencies.readLocalIndex.mockResolvedValue([
      "/plugins/local.js",
    ]);
    fixture.dependencies.fetchSource.mockResolvedValue("old");
    fixture.dependencies.fetchSource.mockResolvedValue("new");

    await fixture.loader.ensurePluginsLoaded();

    expect(previousCleanup).toHaveBeenCalledOnce();
    expect(nextSetup).toHaveBeenCalledOnce();
    expect(fixture.store.plugins[0]).toMatchObject({
      source: "new",
      version: "2.0.0",
      enabled: true,
    });
  });

  it("does not recreate a record uninstalled during local discovery", async () => {
    const fixture = loaderFixture([installed({ local: true })]);
    const pending = deferred<string>();
    fixture.dependencies.readLocalIndex.mockResolvedValue([
      "/plugins/local.js",
    ]);
    fixture.dependencies.fetchSource.mockReturnValue(pending.promise);
    const startup = fixture.loader.ensurePluginsLoaded();
    await vi.waitFor(() =>
      expect(fixture.dependencies.fetchSource).toHaveBeenCalledOnce(),
    );

    fixture.loader.uninstallPlugin("plugin-loader-test");
    pending.resolve("new");
    await startup;

    expect(fixture.store.plugins).toEqual([]);
    expect(fixture.store.upsert).not.toHaveBeenCalled();
    expect(registerNodeDefinitions).not.toHaveBeenCalled();
  });

  it("finishes remaining cleanup and removes nodes even when a plugin disposer throws", () => {
    const fixture = loaderFixture();
    const removeCss = vi.fn();
    injectCSS.mockReturnValue(removeCss);
    const report = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fixture.loader.activatePlugin(
      plugin({
        css: ".test {}",
        setup: () => () => {
          throw new Error("cleanup failed");
        },
      }),
    );

    expect(() =>
      fixture.loader.deactivatePlugin("plugin-loader-test"),
    ).not.toThrow();

    expect(removeCss).toHaveBeenCalledOnce();
    expect(unregisterPluginNodes).toHaveBeenCalledWith("plugin-loader-test");
    expect(report).toHaveBeenCalledOnce();
  });
});
