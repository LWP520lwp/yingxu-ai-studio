import { registerAtlasNodeDefinitions, unregisterAtlasPluginNodes } from "@/atlas-engine/model/node-registry";
import { createPluginOperationClock } from "./operation-gate";
import { createRetryableStartup } from "./retryable-startup";
import { addPluginRefreshToken, resolvePluginSourceUrl } from "./url";
import { getAtlasPluginRuntime } from "./runtime";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin, CanvasPluginApp } from "@/types/canvas-plugin";
import i18n from "@/i18n";

type RunningPlugin = Readonly<{
  definition: CanvasPlugin;
  source?: string;
  dispose: () => void;
}>;

type PluginPersistence = Pick<
  ReturnType<typeof usePluginStore.getState>,
  "plugins" | "upsert" | "setEnabled" | "remove"
>;

type PluginInstallOptions = Readonly<{
  official?: boolean;
  bustCache?: boolean;
  local?: boolean;
}>;

export type AtlasPluginLoaderDependencies = Readonly<{
  getStore: () => PluginPersistence;
  rehydrate: () => void | Promise<unknown>;
  fetchSource: (url: string) => Promise<string>;
  evaluateSource: (source: string) => Promise<CanvasPlugin>;
  readLocalIndex: () => Promise<unknown>;
  getRuntime: () => CanvasPluginApp;
  getOrigin: () => string;
  getDevelopmentSources: () => string | undefined;
}>;

function invalidPlugin() {
  return new Error(i18n.t("canvas.pluginErrors.invalidExport"));
}

function supersededPluginOperation() {
  return new Error("Plugin operation was superseded by a newer change");
}

function validatePluginExport(input: unknown): asserts input is CanvasPlugin {
  if (!input || typeof input !== "object") throw invalidPlugin();
  const candidate = input as Partial<CanvasPlugin>;
  if (
    typeof candidate.id !== "string" || !candidate.id || candidate.id.length > 128 ||
    /[\s\u0000-\u001f/\\]/.test(candidate.id) ||
    !Array.isArray(candidate.nodes) || candidate.nodes.length === 0
  ) {
    throw new Error(i18n.t("canvas.pluginErrors.missingFields"));
  }
  for (const field of ["name", "version", "description", "css"] as const) {
    if (candidate[field] !== undefined && typeof candidate[field] !== "string") throw invalidPlugin();
  }
  if (candidate.setup !== undefined && typeof candidate.setup !== "function") throw invalidPlugin();

  const types = new Set<string>();
  for (const definition of candidate.nodes) {
    if (
      !definition || typeof definition !== "object" ||
      typeof definition.type !== "string" || !definition.type.trim() ||
      typeof definition.title !== "string" || !definition.title.trim() ||
      !definition.defaultSize || !Number.isFinite(definition.defaultSize.width) ||
      definition.defaultSize.width <= 0 || !Number.isFinite(definition.defaultSize.height) ||
      definition.defaultSize.height <= 0 || types.has(definition.type)
    ) throw invalidPlugin();
    types.add(definition.type);
  }
}

function releaseInReverse(pluginId: string, actions: Array<() => void>) {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    try {
      actions[index]();
    } catch (error) {
      console.error(`[plugin] Failed to clean up: ${pluginId}`, error);
    }
  }
}

export function createAtlasPluginLoader(dependencies: AtlasPluginLoaderDependencies) {
  const running = new Map<string, RunningPlugin>();
  const operations = createPluginOperationClock();
  let storageRehydrated = false;

  const allowedSource = (url: string) => Boolean(resolvePluginSourceUrl(url, dependencies.getOrigin()));
  const refreshedSource = (url: string) => addPluginRefreshToken(url, dependencies.getOrigin(), Date.now());

  async function compile(source: string, expectedId?: string) {
    const definition = await dependencies.evaluateSource(source);
    validatePluginExport(definition);
    if (expectedId !== undefined && definition.id !== expectedId) throw invalidPlugin();
    return definition;
  }

  function start(definition: CanvasPlugin, source?: string) {
    if (running.has(definition.id)) return;
    const cleanup: Array<() => void> = [];
    try {
      const runtime = dependencies.getRuntime();
      registerAtlasNodeDefinitions(definition.nodes, definition.id);
      if (definition.css) cleanup.push(runtime.injectCSS(definition.css, definition.id));
      const shutdown = definition.setup?.(runtime);
      if (typeof shutdown === "function") cleanup.push(shutdown);
      running.set(definition.id, {
        definition,
        source,
        dispose: () => releaseInReverse(definition.id, cleanup),
      });
    } catch (error) {
      releaseInReverse(definition.id, cleanup);
      unregisterAtlasPluginNodes(definition.id);
      throw error;
    }
  }

  function stop(pluginId: string) {
    const previous = running.get(pluginId);
    running.delete(pluginId);
    try {
      previous?.dispose();
    } finally {
      unregisterAtlasPluginNodes(pluginId);
    }
  }

  function restore(previous: RunningPlugin, revision: number) {
    if (!operations.isCurrent(previous.definition.id, revision)) return;
    try {
      start(previous.definition, previous.source);
    } catch (error) {
      console.error(`[plugin] Failed to restore previous version: ${previous.definition.id}`, error);
    }
  }

  function replace(definition: CanvasPlugin, revision: number, source?: string) {
    if (!operations.isCurrent(definition.id, revision)) return false;
    const previous = running.get(definition.id);
    stop(definition.id);
    if (!operations.isCurrent(definition.id, revision)) return false;
    try {
      start(definition, source);
      return true;
    } catch (error) {
      if (previous) restore(previous, revision);
      throw error;
    }
  }

  function activatePlugin(definition: CanvasPlugin) {
    validatePluginExport(definition);
    operations.beginFor(definition.id);
    start(definition);
  }

  function deactivatePlugin(pluginId: string) {
    operations.beginFor(pluginId);
    stop(pluginId);
  }

  function replaceActivePlugin(definition: CanvasPlugin) {
    validatePluginExport(definition);
    return replace(definition, operations.beginFor(definition.id));
  }

  async function installFromUrl(url: string, options?: PluginInstallOptions, expectedId?: string) {
    if (!allowedSource(url)) throw invalidPlugin();
    const revision = operations.begin();
    const source = await dependencies.fetchSource(options?.bustCache ? refreshedSource(url) : url);
    const definition = await compile(source, expectedId);
    if (!operations.claim(definition.id, revision)) throw supersededPluginOperation();

    const store = dependencies.getStore();
    const previousRecord = store.plugins.find((record) => record.id === definition.id);
    const previousRuntime = running.get(definition.id);
    stop(definition.id);
    try {
      if (!operations.isCurrent(definition.id, revision)) throw supersededPluginOperation();
      start(definition, source);
      if (!operations.isCurrent(definition.id, revision)) throw supersededPluginOperation();
      dependencies.getStore().upsert({
        id: definition.id,
        name: definition.name || definition.id,
        version: definition.version || "0.0.0",
        description: definition.description,
        url,
        source,
        enabled: true,
        local: options?.local ?? previousRecord?.local,
        official: options?.official ?? previousRecord?.official,
        installedAt: previousRecord?.installedAt,
      });
    } catch (error) {
      if (operations.isCurrent(definition.id, revision)) {
        stop(definition.id);
        if (previousRuntime) restore(previousRuntime, revision);
        else if (previousRecord?.enabled && previousRecord.source) {
          try {
            const cached = await compile(previousRecord.source, definition.id);
            if (operations.isCurrent(definition.id, revision)) start(cached, previousRecord.source);
          } catch (restoreError) {
            console.error(`[plugin] Failed to restore previous version: ${definition.id}`, restoreError);
          }
        }
      }
      throw error;
    }
    return definition;
  }

  function installPluginFromUrl(url: string, options?: PluginInstallOptions) {
    return installFromUrl(url, options);
  }

  function updatePlugin(record: InstalledPlugin) {
    return installFromUrl(record.url, {
      official: record.official,
      bustCache: true,
      local: record.local,
    }, record.id);
  }

  async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    const revision = operations.beginFor(record.id);
    const store = dependencies.getStore();
    const current = store.plugins.find((item) => item.id === record.id);
    if (!current) throw supersededPluginOperation();
    if (!enabled) {
      stop(record.id);
      store.setEnabled(record.id, false);
      return;
    }

    const source = current.local ? await dependencies.fetchSource(refreshedSource(current.url)) : current.source;
    const definition = await compile(source, record.id);
    if (!operations.isCurrent(record.id, revision)) throw supersededPluginOperation();
    if (current.local) replace(definition, revision, source);
    else start(definition, source);
    if (!operations.isCurrent(record.id, revision)) throw supersededPluginOperation();

    if (current.local) {
      store.upsert({
        ...current,
        name: definition.name || definition.id,
        version: definition.version || "0.0.0",
        description: definition.description,
        source,
        enabled: true,
      });
    } else store.setEnabled(record.id, true);
  }

  function uninstallPlugin(pluginId: string) {
    operations.beginFor(pluginId);
    stop(pluginId);
    dependencies.getStore().remove(pluginId);
  }

  async function discoverLocalPlugins() {
    const revision = operations.begin();
    let entries: unknown;
    try {
      entries = await dependencies.readLocalIndex();
      if (!Array.isArray(entries)) throw invalidPlugin();
    } catch (error) {
      console.error("[plugin] Failed to discover local plugins", error);
      return false;
    }

    let complete = true;
    const handled = new Set<string>();
    const sources = new Set(entries as unknown[]);
    await Promise.all([...sources].map(async (entry) => {
      try {
        if (typeof entry !== "string" || !allowedSource(entry)) throw invalidPlugin();
        const source = await dependencies.fetchSource(refreshedSource(entry));
        const definition = await compile(source);
        if (!operations.claim(definition.id, revision) || handled.has(definition.id)) return;
        handled.add(definition.id);
        const existing = dependencies.getStore().plugins.find((item) => item.id === definition.id);
        if (existing && !existing.local) return;
        dependencies.getStore().upsert({
          ...existing,
          id: definition.id,
          name: definition.name || definition.id,
          version: definition.version || "0.0.0",
          description: definition.description,
          url: entry,
          source,
          enabled: existing?.enabled ?? false,
          local: true,
        });
      } catch (error) {
        complete = false;
        console.error(`[plugin] Failed to discover local plugin: ${String(entry)}`, error);
      }
    }));
    return complete;
  }

  async function loadDevelopmentPlugins() {
    const urls = new Set(dependencies.getDevelopmentSources()?.split(",").map((url) => url.trim()).filter(Boolean));
    let complete = true;
    await Promise.all([...urls].map(async (url) => {
      const revision = operations.begin();
      try {
        if (!allowedSource(url)) throw invalidPlugin();
        const source = await dependencies.fetchSource(refreshedSource(url));
        const definition = await compile(source);
        if (!operations.claim(definition.id, revision)) return;
        replace(definition, revision, source);
      } catch (error) {
        complete = false;
        console.error(`[plugin] Failed to load dev plugin: ${url}`, error);
      }
    }));
    return complete;
  }

  const ensurePluginsLoaded = createRetryableStartup(async () => {
    if (!storageRehydrated) {
      await dependencies.rehydrate();
      storageRehydrated = true;
    }
    const localReady = await discoverLocalPlugins();
    const enabled = dependencies.getStore().plugins.filter((record) => record.enabled);
    let existingReady = true;
    await Promise.all(enabled.map(async (record) => {
      const current = running.get(record.id);
      if (current?.source === record.source) return;
      const revision = operations.beginFor(record.id);
      try {
        const definition = await compile(record.source, record.id);
        if (!operations.isCurrent(record.id, revision)) return;
        if (current) replace(definition, revision, record.source);
        else start(definition, record.source);
      } catch (error) {
        existingReady = false;
        console.error(`[plugin] Failed to load: ${record.id}`, error);
      }
    }));
    const developmentReady = await loadDevelopmentPlugins();
    return localReady && existingReady && developmentReady;
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

async function evaluatePluginModule(source: string): Promise<CanvasPlugin> {
  const objectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const module = await import(/* @vite-ignore */ objectUrl) as { default?: unknown; plugin?: unknown };
    const exported = module.default ?? module.plugin;
    return typeof exported === "function"
      ? await (exported as (runtime: CanvasPluginApp) => CanvasPlugin | Promise<CanvasPlugin>)(getAtlasPluginRuntime())
      : exported as CanvasPlugin;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function requestPluginSource(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(i18n.t("canvas.pluginErrors.downloadFailed", { status: response.status }));
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
} = createAtlasPluginLoader({
  getStore: () => usePluginStore.getState(),
  rehydrate: () => usePluginStore.persist.rehydrate(),
  fetchSource: requestPluginSource,
  evaluateSource: evaluatePluginModule,
  readLocalIndex: async () => {
    const response = await fetch("/plugins/index.json");
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(i18n.t("canvas.pluginErrors.downloadFailed", { status: response.status }));
    return response.json();
  },
  getRuntime: getAtlasPluginRuntime,
  getOrigin: () => window.location.origin,
  getDevelopmentSources: () => import.meta.env.VITE_DEV_PLUGINS,
});
