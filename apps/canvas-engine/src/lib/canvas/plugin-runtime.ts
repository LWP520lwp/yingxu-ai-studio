import React from "react";

import { emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import type { CanvasPluginApp } from "@/types/canvas-plugin";

export type PluginRuntime = CanvasPluginApp & {
  React: typeof React;
  jsx: typeof React.createElement;
  Fragment: typeof React.Fragment;
  injectCSS: (css: string, key?: string) => () => void;
};

type PluginEventBridge = Pick<CanvasPluginApp, "emit" | "on">;

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

function browserStyleHost(): PluginStyleHost {
  return {
    getElementById: (id) =>
      document.getElementById(id) as HTMLStyleElement | null,
    createStyleElement: () => document.createElement("style"),
    appendToHead: (element) =>
      document.head.appendChild(element as HTMLStyleElement),
  };
}

export function createPluginStyleInjector(host: PluginStyleHost) {
  const activeById = new Map<string, PluginStyleElement>();

  return (css: string, key?: string) => {
    const id = key ? `${STYLE_ID_PREFIX}${key}` : "";
    if (id) {
      activeById.get(id)?.remove();
      host.getElementById(id)?.remove();
    }

    const element = host.createStyleElement();
    element.id = id;
    element.dataset.canvasPluginStyle = "true";
    element.textContent = css;
    host.appendToHead(element);
    if (id) activeById.set(id, element);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (id && activeById.get(id) === element) activeById.delete(id);
      element.remove();
    };
  };
}

export function resolvePluginRuntimeVersion(value: unknown): string {
  return typeof value === "string" ? value : "dev";
}

export function createPluginRuntime(
  react: typeof React,
  version: unknown,
  events: PluginEventBridge,
  injectCSS: PluginRuntime["injectCSS"],
): PluginRuntime {
  return {
    React: react,
    jsx: react.createElement,
    Fragment: react.Fragment,
    injectCSS,
    version: resolvePluginRuntimeVersion(version),
    emit: events.emit,
    on: events.on,
  };
}

let runtime: PluginRuntime | null = null;

export function getPluginRuntime(): PluginRuntime {
  if (runtime) return runtime;

  const styleHost = browserStyleHost();
  runtime = createPluginRuntime(
    React,
    typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
    { emit: emitCanvasEvent, on: onCanvasEvent },
    createPluginStyleInjector(styleHost),
  );

  if (typeof window !== "undefined") {
    (
      window as unknown as { InfiniteCanvasRuntime?: PluginRuntime }
    ).InfiniteCanvasRuntime = runtime;
  }
  return runtime;
}
