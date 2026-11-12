import { createScopedStorage } from "@/lib/localforage-storage";
import {
    createCanvasEventDispatch,
    type CanvasEventHandler,
} from "@/lib/canvas/canvas-event-dispatch";

import type { PluginStorage } from "@/types/canvas-plugin";

const eventDispatch = createCanvasEventDispatch((event, error) => {
    console.error(`[canvas-event] handler for "${event}" failed`, error);
});

export function emitCanvasEvent(event: string, payload?: unknown) {
    eventDispatch.emit(event, payload);
}

export function onCanvasEvent(event: string, handler: CanvasEventHandler) {
    return eventDispatch.on(event, handler);
}

// Private plugin storage isolated by pluginId namespace.
const stores = new Map<string, ReturnType<typeof createScopedStorage>>();

export function createPluginStorage(pluginId: string): PluginStorage {
    let store = stores.get(pluginId);
    if (!store) {
        store = createScopedStorage(`plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, "_")}`);
        stores.set(pluginId, store);
    }
    return {
        get: (key) => store!.getItem(key),
        set: async (key, value) => {
            await store!.setItem(key, value);
        },
        remove: async (key) => {
            await store!.removeItem(key);
        },
    };
}
