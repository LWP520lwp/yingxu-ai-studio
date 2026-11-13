import { describe, expect, it } from "vitest";

import {
  appendRecent,
  constrainAgentStorePatch,
  decideAgentConnection,
  restoreAgentPanelWidth,
  transitionAgentPanel,
} from "@/atlas-engine/agent/store-state";

const panel = {
  panelOpen: false,
  panelMounted: true,
  panelClosing: false,
};

describe("agent panel state transitions", () => {
  it("ignores duplicate close events and stale animation completion after reopen", () => {
    const opened = transitionAgentPanel(panel, "open");
    const closing = transitionAgentPanel(opened, "close");

    expect(closing).toMatchObject({
      panelOpen: false,
      panelMounted: true,
      panelClosing: true,
    });
    expect(transitionAgentPanel(closing, "close")).toBe(closing);

    const reopened = transitionAgentPanel(closing, "open");
    expect(transitionAgentPanel(reopened, "finish-close")).toBe(reopened);
  });

  it("finishes a close animation without unmounting the retained agent panel", () => {
    const closing = transitionAgentPanel(
      transitionAgentPanel(panel, "open"),
      "close",
    );

    expect(transitionAgentPanel(closing, "finish-close")).toEqual({
      panelOpen: false,
      panelMounted: true,
      panelClosing: false,
    });
    expect(transitionAgentPanel(panel, "close")).toBe(panel);
  });

  it("bounds restored history and falls back to the current width for invalid input", () => {
    const state = {
      width: 440,
      messages: ["old"],
      eventLogs: ["old-log"],
      preserved: "state",
    };
    const bounded = constrainAgentStorePatch(
      state,
      {
        width: Number.NaN,
        messages: Array.from({ length: 4 }, (_, index) => `message-${index}`),
        eventLogs: Array.from({ length: 3 }, (_, index) => `event-${index}`),
      },
      {
        messages: 2,
        eventLogs: 1,
        panelWidth: { min: 320, max: 720 },
      },
    );

    expect(bounded).toEqual({
      width: 440,
      messages: ["message-2", "message-3"],
      eventLogs: ["event-2"],
    });
    expect(appendRecent([1, 2], 3, 2)).toEqual([2, 3]);
    expect(
      constrainAgentStorePatch(
        state,
        { width: 900 },
        {
          messages: 2,
          eventLogs: 1,
          panelWidth: { min: 320, max: 720 },
        },
      ).width,
    ).toBe(720);
    expect(restoreAgentPanelWidth(600, 440, { min: 320, max: 720 })).toBe(600);
    expect(restoreAgentPanelWidth(100, 440, { min: 320, max: 720 })).toBe(440);
  });

  it("separates missing credentials from a ready connection decision", () => {
    const missing = decideAgentConnection({
      endpoint: null,
      token: "",
      silent: false,
      persisted: false,
      requiredMessage: "Configure credentials",
      storageUnavailableMessage: "Storage unavailable",
      connectingMessage: "Connecting",
    });
    expect(missing).toEqual({
      type: "missing-credentials",
      patch: { connectError: "Configure credentials" },
    });

    const ready = decideAgentConnection({
      endpoint: "https://agent.example",
      token: " secret ",
      silent: false,
      persisted: false,
      requiredMessage: "Configure credentials",
      storageUnavailableMessage: "Storage unavailable",
      connectingMessage: "Connecting",
    });
    expect(ready).toEqual({
      type: "connect",
      patch: {
        url: "https://agent.example",
        token: " secret ",
        enabled: true,
        silentConnect: false,
        fragmentBootstrap: false,
        activity: "Connecting",
        connectError: "Storage unavailable",
      },
    });

    expect(
      decideAgentConnection({
        endpoint: null,
        token: "",
        silent: true,
        persisted: false,
        requiredMessage: "Configure credentials",
        storageUnavailableMessage: "Storage unavailable",
        connectingMessage: "Connecting",
      }).patch,
    ).toEqual({ connectError: "" });
    expect(
      decideAgentConnection({
        endpoint: "https://agent.example",
        token: "secret",
        silent: true,
        persisted: false,
        requiredMessage: "Configure credentials",
        storageUnavailableMessage: "Storage unavailable",
        connectingMessage: "Connecting",
      }).patch.connectError,
    ).toBe("");
  });
});
