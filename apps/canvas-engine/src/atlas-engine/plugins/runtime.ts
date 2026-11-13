import React from "react";
import {
  emitAtlasPluginEvent as emitCanvasEvent,
  onAtlasPluginEvent as onCanvasEvent,
} from "@/atlas-engine/plugins/events";
import type { CanvasPluginApp } from "@/types/canvas-plugin";

export type AtlasPluginRuntime = CanvasPluginApp & {
  React: typeof React;
  jsx: typeof React.createElement;
  Fragment: typeof React.Fragment;
  injectCSS: (css: string, key?: string) => () => void;
};

type EventBridge = Pick<CanvasPluginApp, "emit" | "on">;

export type PluginStyleElement = {
  id: string;
  textContent: string | null;
  dataset: { canvasPluginStyle?: string };
  remove: () => void;
};

export type PluginStyleHost = {
  getElementById: (id: string) => PluginStyleElement | null;
  createStyleElement: () => PluginStyleElement;
  appendToHead: (element: PluginStyleElement) => void;
};

const STYLE_ID_PREFIX = "canvas-plugin-style-";

export function createPluginStyleWriter(host: PluginStyleHost) {
  const active = new Map<string, PluginStyleElement>();
  return (css: string, key?: string) => {
    const id = key ? `${STYLE_ID_PREFIX}${key}` : "";
    if (id) {
      active.get(id)?.remove();
      host.getElementById(id)?.remove();
    }

    const element = host.createStyleElement();
    element.id = id;
    element.dataset.canvasPluginStyle = "true";
    element.textContent = css;
    host.appendToHead(element);
    if (id) active.set(id, element);

    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      if (id && active.get(id) === element) active.delete(id);
      element.remove();
    };
  };
}

export function appVersionOrDevelopment(value: unknown): string {
  return typeof value === "string" ? value : "dev";
}

export function makeAtlasPluginRuntime(
  react: typeof React,
  version: unknown,
  events: EventBridge,
  injectCSS: AtlasPluginRuntime["injectCSS"],
): AtlasPluginRuntime {
  return {
    React: react,
    jsx: react.createElement,
    Fragment: react.Fragment,
    version: appVersionOrDevelopment(version),
    emit: events.emit,
    on: events.on,
    injectCSS,
  };
}

function createBrowserStyleHost(): PluginStyleHost {
  return {
    getElementById: (id) => document.getElementById(id) as HTMLStyleElement | null,
    createStyleElement: () => document.createElement("style"),
    appendToHead: (element) => { document.head.appendChild(element as HTMLStyleElement); },
  };
}

let singleton: AtlasPluginRuntime | undefined;

export function getAtlasPluginRuntime(): AtlasPluginRuntime {
  if (singleton) return singleton;
  singleton = makeAtlasPluginRuntime(
    React,
    typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
    { emit: emitCanvasEvent, on: onCanvasEvent },
    createPluginStyleWriter(createBrowserStyleHost()),
  );
  if (typeof window !== "undefined") {
    (window as unknown as { InfiniteCanvasRuntime?: AtlasPluginRuntime }).InfiniteCanvasRuntime = singleton;
  }
  return singleton;
}
