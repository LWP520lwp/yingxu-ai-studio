import { describe, expect, it } from "vitest";

import { defaultConfig, defaultWebdavSyncConfig } from "@/lib/config/defaults";
import { transitionConfigStore } from "@/lib/config/store-transitions";

const initial = {
  config: defaultConfig,
  webdav: defaultWebdavSyncConfig,
  isConfigOpen: false,
  configTab: "channels" as const,
  shouldPromptContinue: false,
};

describe("configuration store transitions", () => {
  it("updates a preference immutably while preserving unrelated state", () => {
    const next = transitionConfigStore(initial, {
      type: "update-config",
      key: "proxyEnabled",
      value: true,
    });

    expect(next.config.proxyEnabled).toBe(true);
    expect(next.config).not.toBe(initial.config);
    expect(next.webdav).toBe(initial.webdav);
    expect(initial.config.proxyEnabled).toBe(false);
  });

  it("updates WebDAV fields without changing the AI configuration", () => {
    const next = transitionConfigStore(initial, {
      type: "update-webdav",
      key: "directory",
      value: "/projects",
    });

    expect(next.webdav.directory).toBe("/projects");
    expect(next.webdav).not.toBe(initial.webdav);
    expect(next.config).toBe(initial.config);
  });

  it("opens the requested configuration tab with an explicit continuation state", () => {
    const next = transitionConfigStore(initial, {
      type: "open-dialog",
      shouldPromptContinue: true,
      tab: "webdav",
    });

    expect(next).toMatchObject({
      isConfigOpen: true,
      configTab: "webdav",
      shouldPromptContinue: true,
    });
  });

  it("reopening without options restores the default tab and prompt behavior", () => {
    const opened = transitionConfigStore(
      { ...initial, configTab: "webdav", shouldPromptContinue: true },
      { type: "open-dialog" },
    );
    expect(opened).toMatchObject({
      isConfigOpen: true,
      configTab: "channels",
      shouldPromptContinue: false,
    });
  });

  it("clears a pending continuation without changing visibility or selected tab", () => {
    const cleared = transitionConfigStore(
      {
        ...initial,
        isConfigOpen: true,
        configTab: "webdav",
        shouldPromptContinue: true,
      },
      { type: "clear-prompt-continue" },
    );

    expect(cleared).toMatchObject({
      shouldPromptContinue: false,
      isConfigOpen: true,
      configTab: "webdav",
    });
  });

  it("changes dialog visibility without discarding the prompt state", () => {
    const state = { ...initial, shouldPromptContinue: true };
    const closed = transitionConfigStore(state, {
      type: "set-dialog-open",
      isOpen: false,
    });

    expect(closed.isConfigOpen).toBe(false);
    expect(closed.shouldPromptContinue).toBe(true);
  });
});
