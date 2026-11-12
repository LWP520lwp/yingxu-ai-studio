import {
  registerNodeDefinitions,
  unregisterPluginNodes,
} from "@/lib/canvas/node-registry";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";
import { createPluginOperationGate } from "@/lib/canvas/plugin-operation-gate";
import { createRetryableLoader } from "@/lib/canvas/retryable-loader";
import {
  addPluginCacheBuster,
  normalizePluginHttpUrl,
} from "@/lib/canvas/plugin-url";
import {
  usePluginStore,
  type InstalledPlugin,
} from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin, CanvasPluginApp } from "@/types/canvas-plugin";
import i18n from "@/i18n";

type ActivePlugin = {
  plugin: CanvasPlugin;
  source?: string;
  dispose: () => void;
};
type PluginPersistence = Pick<
  ReturnType<typeof usePluginStore.getState>,
  "plugins" | "upsert" | "setEnabled" | "remove"
>;
type InstallOptions = {
  official?: boolean;
  bustCache?: boolean;
  local?: boolean;
};

export type PluginLoaderDependencies = {
  getStore: () => PluginPersistence;
  rehydrate: () => void | Promise<unknown>;
  fetchSource: (url: string) => Promise<string>;
  evaluateSource: (source: string) => Promise<CanvasPlugin>;
  readLocalIndex: () => Promise<unknown>;
  getRuntime: () => CanvasPluginApp;
  getOrigin: () => string;
  getDevSources: () => string | undefined;
};

function invalidPlugin() {
  return new Error(i18n.t("canvas.pluginErrors.invalidExport"));
}

function supersededError() {
  return new Error("Plugin operation was superseded by a newer change");
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
  const value = plugin as Partial<CanvasPlugin> | null;
  if (!value || typeof value !== "object") throw invalidPlugin();
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 128 ||
    /[\s\u0000-\u001f/\\]/.test(value.id) ||
    !Array.isArray(value.nodes) ||
    !value.nodes.length
  ) {
    throw new Error(i18n.t("canvas.pluginErrors.missingFields"));
  }
  for (const field of ["name", "version", "description", "css"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw invalidPlugin();
    }
  }
  if (value.setup !== undefined && typeof value.setup !== "function") {
    throw invalidPlugin();
  }
  const types = new Set<string>();
  for (const node of value.nodes) {
    if (
      !node ||
      typeof node !== "object" ||
      typeof node.type !== "string" ||
      !node.type.trim() ||
      typeof node.title !== "string" ||
      !node.title.trim() ||
      !node.defaultSize ||
      !Number.isFinite(node.defaultSize.width) ||
      node.defaultSize.width <= 0 ||
      !Number.isFinite(node.defaultSize.height) ||
      node.defaultSize.height <= 0 ||
      types.has(node.type)
    ) {
      throw invalidPlugin();
    }
    types.add(node.type);
  }
}

function disposeAll(pluginId: string, disposers: Array<() => void>) {
  for (let index = disposers.length - 1; index >= 0; index -= 1) {
    try {
      disposers[index]();
    } catch (error) {
      console.error(`[plugin] Failed to clean up: ${pluginId}`, error);
    }
  }
}

// Each loader owns its active instances and revisions. A failed or superseded
// download cannot change another instance or resurrect an uninstalled plugin.
export function createPluginLoader(dependencies: PluginLoaderDependencies) {
  const active = new Map<string, ActivePlugin>();
  const operations = createPluginOperationGate();
  let hydrated = false;

  const isAllowedUrl = (url: string) =>
    Boolean(normalizePluginHttpUrl(url, dependencies.getOrigin()));
  const freshUrl = (url: string) =>
    addPluginCacheBuster(url, dependencies.getOrigin(), Date.now());

  async function evaluate(source: string, expectedId?: string) {
    const plugin = await dependencies.evaluateSource(source);
    assertPlugin(plugin);
    if (expectedId !== undefined && plugin.id !== expectedId) {
      throw invalidPlugin();
    }
    return plugin;
  }

  function activate(plugin: CanvasPlugin, source?: string) {
    if (active.has(plugin.id)) return;
    const disposers: Array<() => void> = [];
    try {
      const runtime = dependencies.getRuntime();
      registerNodeDefinitions(plugin.nodes, plugin.id);
      if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
      const cleanup = plugin.setup?.(runtime);
      if (typeof cleanup === "function") disposers.push(cleanup);
      active.set(plugin.id, {
        plugin,
        source,
        dispose: () => disposeAll(plugin.id, disposers),
      });
    } catch (error) {
      disposeAll(plugin.id, disposers);
      unregisterPluginNodes(plugin.id);
      throw error;
    }
  }

  function dispose(pluginId: string) {
    const previous = active.get(pluginId);
    active.delete(pluginId);
    try {
      previous?.dispose();
    } finally {
      unregisterPluginNodes(pluginId);
    }
  }

  function restore(plugin: CanvasPlugin, revision: number, source?: string) {
    if (!operations.isCurrent(plugin.id, revision)) return;
    try {
      activate(plugin, source);
    } catch (error) {
      console.error(
        `[plugin] Failed to restore previous version: ${plugin.id}`,
        error,
      );
    }
  }

  function replace(plugin: CanvasPlugin, revision: number, source?: string) {
    if (!operations.isCurrent(plugin.id, revision)) return false;
    const previous = active.get(plugin.id);
    dispose(plugin.id);
    if (!operations.isCurrent(plugin.id, revision)) return false;
    try {
      activate(plugin, source);
      return true;
    } catch (error) {
      if (previous) restore(previous.plugin, revision, previous.source);
      throw error;
    }
  }

  function activatePlugin(plugin: CanvasPlugin) {
    assertPlugin(plugin);
    operations.beginFor(plugin.id);
    activate(plugin);
  }

  function deactivatePlugin(pluginId: string) {
    operations.beginFor(pluginId);
    dispose(pluginId);
  }

  function replaceActivePlugin(plugin: CanvasPlugin) {
    assertPlugin(plugin);
    return replace(plugin, operations.beginFor(plugin.id));
  }

  async function install(
    url: string,
    options?: InstallOptions,
    expectedId?: string,
  ) {
    if (!isAllowedUrl(url)) throw invalidPlugin();
    const revision = operations.begin();
    const source = await dependencies.fetchSource(
      options?.bustCache ? freshUrl(url) : url,
    );
    const plugin = await evaluate(source, expectedId);
    if (!operations.claim(plugin.id, revision)) throw supersededError();
    const previous = dependencies
      .getStore()
      .plugins.find((item) => item.id === plugin.id);
    const previousRuntime = active.get(plugin.id);
    dispose(plugin.id);
    try {
      if (!operations.isCurrent(plugin.id, revision)) throw supersededError();
      activate(plugin, source);
      if (!operations.isCurrent(plugin.id, revision)) throw supersededError();
      dependencies.getStore().upsert({
        id: plugin.id,
        name: plugin.name || plugin.id,
        version: plugin.version || "0.0.0",
        description: plugin.description,
        url,
        source,
        enabled: true,
        local: options?.local ?? previous?.local,
        official: options?.official ?? previous?.official,
        installedAt: previous?.installedAt,
      });
    } catch (error) {
      if (operations.isCurrent(plugin.id, revision)) {
        dispose(plugin.id);
        if (previousRuntime) {
          restore(previousRuntime.plugin, revision, previousRuntime.source);
        } else if (previous?.enabled && previous.source) {
          try {
            const cached = await evaluate(previous.source, plugin.id);
            restore(cached, revision, previous.source);
          } catch (restoreError) {
            console.error(
              `[plugin] Failed to restore previous version: ${plugin.id}`,
              restoreError,
            );
          }
        }
      }
      throw error;
    }
    return plugin;
  }

  function installPluginFromUrl(url: string, options?: InstallOptions) {
    return install(url, options);
  }

  function updatePlugin(record: InstalledPlugin) {
    return install(
      record.url,
      {
        official: record.official,
        bustCache: true,
        local: record.local,
      },
      record.id,
    );
  }

  async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    const revision = operations.beginFor(record.id);
    const current = dependencies
      .getStore()
      .plugins.find((item) => item.id === record.id);
    if (!current) throw supersededError();
    if (!enabled) {
      dispose(record.id);
      dependencies.getStore().setEnabled(record.id, false);
      return;
    }
    const source = current.local
      ? await dependencies.fetchSource(freshUrl(current.url))
      : current.source;
    const plugin = await evaluate(source, record.id);
    if (!operations.isCurrent(record.id, revision)) throw supersededError();
    if (current.local) replace(plugin, revision, source);
    else activate(plugin, source);
    if (!operations.isCurrent(record.id, revision)) throw supersededError();
    if (current.local) {
      dependencies.getStore().upsert({
        ...current,
        name: plugin.name || plugin.id,
        version: plugin.version || "0.0.0",
        description: plugin.description,
        source,
        enabled: true,
      });
    } else dependencies.getStore().setEnabled(record.id, true);
  }

  function uninstallPlugin(pluginId: string) {
    operations.beginFor(pluginId);
    dispose(pluginId);
    dependencies.getStore().remove(pluginId);
  }

  async function loadLocalPlugins() {
    const revision = operations.begin();
    let sources: unknown;
    try {
      sources = await dependencies.readLocalIndex();
      if (!Array.isArray(sources)) throw invalidPlugin();
    } catch (error) {
      console.error("[plugin] Failed to discover local plugins", error);
      return false;
    }
    let complete = true;
    const seenPluginIds = new Set<string>();
    const urls = new Set(sources as unknown[]);
    await Promise.all(
      [...urls].map(async (url) => {
        try {
          if (typeof url !== "string" || !isAllowedUrl(url))
            throw invalidPlugin();
          const source = await dependencies.fetchSource(freshUrl(url));
          const plugin = await evaluate(source);
          if (!operations.claim(plugin.id, revision)) return;
          if (seenPluginIds.has(plugin.id)) return;
          seenPluginIds.add(plugin.id);
          const existing = dependencies
            .getStore()
            .plugins.find((item) => item.id === plugin.id);
          // An explicit remote install keeps ownership when a bundled plugin
          // happens to use the same identifier.
          if (existing && !existing.local) return;
          dependencies.getStore().upsert({
            ...existing,
            id: plugin.id,
            name: plugin.name || plugin.id,
            version: plugin.version || "0.0.0",
            description: plugin.description,
            url,
            source,
            enabled: existing?.enabled ?? false,
            local: true,
          });
        } catch (error) {
          complete = false;
          console.error(
            `[plugin] Failed to discover local plugin: ${String(url)}`,
            error,
          );
        }
      }),
    );
    return complete;
  }

  async function loadDevPlugins() {
    const urls = new Set(
      dependencies
        .getDevSources()
        ?.split(",")
        .map((url) => url.trim())
        .filter(Boolean),
    );
    let complete = true;
    await Promise.all(
      [...urls].map(async (url) => {
        const revision = operations.begin();
        try {
          if (!isAllowedUrl(url)) throw invalidPlugin();
          const source = await dependencies.fetchSource(freshUrl(url));
          const plugin = await evaluate(source);
          if (!operations.claim(plugin.id, revision)) return;
          replace(plugin, revision, source);
        } catch (error) {
          complete = false;
          console.error(`[plugin] Failed to load dev plugin: ${url}`, error);
        }
      }),
    );
    return complete;
  }

  const ensurePluginsLoaded = createRetryableLoader(async () => {
    if (!hydrated) {
      await dependencies.rehydrate();
      hydrated = true;
    }
    const localLoaded = await loadLocalPlugins();
    const records = dependencies
      .getStore()
      .plugins.filter((record) => record.enabled);
    let complete = true;
    await Promise.all(
      records.map(async (record) => {
        const running = active.get(record.id);
        if (running?.source === record.source) return;
        const revision = operations.beginFor(record.id);
        try {
          const plugin = await evaluate(record.source, record.id);
          if (operations.isCurrent(record.id, revision)) {
            if (running) replace(plugin, revision, record.source);
            else activate(plugin, record.source);
          }
        } catch (error) {
          complete = false;
          console.error(`[plugin] Failed to load: ${record.id}`, error);
        }
      }),
    );
    const devLoaded = await loadDevPlugins();
    return complete && localLoaded && devLoaded;
  });

  return {
    activatePlugin,
    deactivatePlugin,
    replaceActivePlugin,
    installPluginFromUrl,
    updatePlugin,
    setPluginEnabled,
    uninstallPlugin,
    ensurePluginsLoaded,
  };
}

// Plugin packages either export a definition or a factory using host React.
async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {
  const objectUrl = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    const module = (await import(/* @vite-ignore */ objectUrl)) as {
      default?: unknown;
      plugin?: unknown;
    };
    const value = module.default ?? module.plugin;
    return (
      typeof value === "function"
        ? (value as (runtime: unknown) => unknown)(getPluginRuntime())
        : value
    ) as CanvasPlugin;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchPluginSource(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      i18n.t("canvas.pluginErrors.downloadFailed", { status: response.status }),
    );
  }
  return response.text();
}

export const {
  activatePlugin,
  deactivatePlugin,
  replaceActivePlugin,
  installPluginFromUrl,
  updatePlugin,
  setPluginEnabled,
  uninstallPlugin,
  ensurePluginsLoaded,
} = createPluginLoader({
  getStore: () => usePluginStore.getState(),
  rehydrate: () => usePluginStore.persist.rehydrate(),
  fetchSource: fetchPluginSource,
  evaluateSource: evaluatePluginSource,
  readLocalIndex: async () => {
    const response = await fetch("/plugins/index.json");
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new Error(
        i18n.t("canvas.pluginErrors.downloadFailed", {
          status: response.status,
        }),
      );
    }
    return response.json();
  },
  getRuntime: getPluginRuntime,
  getOrigin: () => window.location.origin,
  getDevSources: () => import.meta.env.VITE_DEV_PLUGINS,
});
