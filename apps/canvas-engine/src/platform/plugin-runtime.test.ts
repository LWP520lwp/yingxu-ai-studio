import React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createPluginRuntime,
  createPluginStyleInjector,
  getPluginRuntime,
  resolvePluginRuntimeVersion,
  type PluginStyleElement,
} from "@/lib/canvas/plugin-runtime";

function createStyleHost() {
  const elements: PluginStyleElement[] = [];
  return {
    elements,
    host: {
      getElementById: (id: string) =>
        elements.find((element) => element.id === id) ?? null,
      createStyleElement: () => ({
        id: "",
        textContent: "",
        dataset: {},
        remove: vi.fn(function (this: PluginStyleElement) {
          const index = elements.indexOf(this);
          if (index >= 0) elements.splice(index, 1);
        }),
      }),
      appendToHead: (element: PluginStyleElement) => elements.push(element),
    },
  };
}

describe("plugin runtime", () => {
  it("shares the host React instance and forwards version and event capabilities", () => {
    const emit = vi.fn();
    const on = vi.fn(() => vi.fn());
    const injectCSS = vi.fn(() => vi.fn());
    const runtime = createPluginRuntime(
      React,
      "2.4.1",
      { emit, on },
      injectCSS,
    );

    expect(runtime.React).toBe(React);
    expect(runtime.jsx).toBe(React.createElement);
    expect(runtime.Fragment).toBe(React.Fragment);
    expect(runtime.version).toBe("2.4.1");
    expect(runtime.emit).toBe(emit);
    expect(runtime.on).toBe(on);
    expect(runtime.injectCSS).toBe(injectCSS);
    expect(resolvePluginRuntimeVersion(undefined)).toBe("dev");
    expect(resolvePluginRuntimeVersion(42)).toBe("dev");
    expect(resolvePluginRuntimeVersion("")).toBe("");
  });

  it("replaces keyed styles and stale cleanup cannot remove the replacement", () => {
    const { elements, host } = createStyleHost();
    const inject = createPluginStyleInjector(host);

    const removeOld = inject(".node { color: red }", "plugin-a");
    const oldElement = elements[0];
    const removeNew = inject(".node { color: blue }", "plugin-a");

    expect(elements).toHaveLength(1);
    expect(elements[0]).not.toBe(oldElement);
    expect(elements[0]).toMatchObject({
      id: "canvas-plugin-style-plugin-a",
      textContent: ".node { color: blue }",
      dataset: { canvasPluginStyle: "true" },
    });

    removeOld();
    expect(elements).toHaveLength(1);
    removeNew();
    expect(elements).toHaveLength(0);
    removeNew();
    expect(elements).toHaveLength(0);
  });

  it("keeps unkeyed styles independent and replaces an existing keyed style", () => {
    const { elements, host } = createStyleHost();
    const inject = createPluginStyleInjector(host);
    const preexisting: PluginStyleElement = {
      id: "canvas-plugin-style-plugin-b",
      textContent: ".old {}",
      dataset: { canvasPluginStyle: "true" },
      remove: vi.fn(() => {
        const index = elements.indexOf(preexisting);
        if (index >= 0) elements.splice(index, 1);
      }),
    };
    elements.push(preexisting);
    const removeFirst = inject(".a {}", "plugin-b");
    const removeUnkeyedOne = inject(".b {}");
    const removeUnkeyedTwo = inject(".c {}");

    expect(elements).toHaveLength(3);
    expect(preexisting.remove).toHaveBeenCalledOnce();
    expect(elements.filter((element) => !element.id)).toHaveLength(2);

    const removeSecond = inject(".d {}", "plugin-b");
    expect(elements).toHaveLength(3);
    removeFirst();
    expect(elements).toHaveLength(3);
    removeSecond();
    removeUnkeyedOne();
    removeUnkeyedTwo();
    expect(elements).toHaveLength(0);
  });

  it("returns one module singleton from the public accessor", () => {
    const browserWindow: Record<string, unknown> = {};
    vi.stubGlobal("window", browserWindow);
    expect(getPluginRuntime()).toBe(getPluginRuntime());
    const runtime = getPluginRuntime();
    expect(runtime.React).toBe(React);
    expect(browserWindow.InfiniteCanvasRuntime).toBe(runtime);
    vi.unstubAllGlobals();
  });
});
