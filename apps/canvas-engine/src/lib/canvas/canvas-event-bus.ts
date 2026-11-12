import { createScopedStorage } from "@/lib/localforage-storage";
import type { PluginStorage } from "@/types/canvas-plugin";

type Listener = (payload?: unknown) => void;

class CanvasEvents {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly report: (name: string, error: unknown) => void) {}

  subscribe(name: string, listener: Listener) {
    const topic = this.listeners.get(name) ?? new Set<Listener>();
    topic.add(listener);
    this.listeners.set(name, topic);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      topic.delete(listener);
      if (!topic.size && this.listeners.get(name) === topic) this.listeners.delete(name);
    };
  }

  publish(name: string, payload?: unknown) {
    const topic = this.listeners.get(name);
    if (!topic) return;
    for (const listener of [...topic]) {
      if (!topic.has(listener)) continue;
      try {
        listener(payload);
      } catch (error) {
        this.report(name, error);
      }
    }
  }
}

const events = new CanvasEvents((name, error) => {
  console.error(`[canvas-event] handler for "${name}" failed`, error);
});

export function emitCanvasEvent(event: string, payload?: unknown) {
  events.publish(event, payload);
}

export function onCanvasEvent(event: string, handler: Listener) {
  return events.subscribe(event, handler);
}

const pluginStores = new Map<string, ReturnType<typeof createScopedStorage>>();

export function createPluginStorage(pluginId: string): PluginStorage {
  const namespace = `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  let storage = pluginStores.get(namespace);
  if (!storage) {
    storage = createScopedStorage(namespace);
    pluginStores.set(namespace, storage);
  }

  return {
    get: (key) => storage!.getItem(key),
    set: async (key, value) => { await storage!.setItem(key, value); },
    remove: async (key) => { await storage!.removeItem(key); },
  };
}
