import { describe, expect, it } from "vitest";
import {
  appendRecent,
  constrainAgentStorePatch,
  createIdleAtlasAgentConversation,
  decideAgentConnection,
  reduceAtlasAgentStore,
  restoreAgentPanelWidth,
  transitionAgentPanel,
} from "@/atlas-engine/agent/store-state";

describe("Atlas agent panel state", () => {
  it("retains mounted panels across close animation and ignores stale completions", () => {
    const closed = { panelOpen: false, panelMounted: true, panelClosing: false };
    const opening = transitionAgentPanel(closed, "open");
    const closing = transitionAgentPanel(opening, "close");
    const reopened = transitionAgentPanel(closing, "open");

    expect(transitionAgentPanel(closing, "close")).toBe(closing);
    expect(transitionAgentPanel(reopened, "finish-close")).toBe(reopened);
    expect(transitionAgentPanel(closing, "finish-close")).toEqual(closed);
  });

  it("caps recent history, bounds restored widths, and limits state patches", () => {
    const state = { width: 440, messages: ["old"], eventLogs: ["old-log"], retained: true };
    expect(constrainAgentStorePatch(state, {
      width: Number.NaN,
      messages: ["a", "b", "c"],
      eventLogs: ["x", "y"],
    }, { messages: 2, eventLogs: 1, panelWidth: { min: 320, max: 720 } })).toEqual({
      width: 440,
      messages: ["b", "c"],
      eventLogs: ["y"],
    });
    expect(appendRecent([1, 2], 3, 2)).toEqual([2, 3]);
    expect(restoreAgentPanelWidth(600, 440, { min: 320, max: 720 })).toBe(600);
    expect(restoreAgentPanelWidth(100, 440, { min: 320, max: 720 })).toBe(440);
  });

  it("distinguishes missing credentials from a ready connection", () => {
    expect(decideAgentConnection({
      endpoint: null,
      token: "",
      silent: false,
      persisted: false,
      requiredMessage: "Configure credentials",
      storageUnavailableMessage: "Storage unavailable",
      connectingMessage: "Connecting",
    })).toEqual({ type: "missing-credentials", patch: { connectError: "Configure credentials" } });

    expect(decideAgentConnection({
      endpoint: "https://agent.example",
      token: "secret",
      silent: true,
      persisted: false,
      requiredMessage: "Configure credentials",
      storageUnavailableMessage: "Storage unavailable",
      connectingMessage: "Connecting",
    }).patch.connectError).toBe("");
  });

  it("resets transient connection state on disconnect while honoring explicit overrides", () => {
    const state = {
      panelOpen: true,
      panelMounted: true,
      panelClosing: false,
      width: 440,
      messages: ["retained"],
      eventLogs: ["event"],
      connected: true,
      enabled: true,
      silentConnect: true,
      fragmentBootstrap: true,
      activity: "Working",
      connectError: "old error",
      conversation: { ...createIdleAtlasAgentConversation(), status: "running" as const },
      bootstrapStatus: { key: "boot", text: "Starting", detail: "Agent", status: "running" as const },
      mcpStartupStatuses: {
        server: { key: "server", text: "Starting", detail: "MCP", status: "running" as const },
      },
    };

    expect(reduceAtlasAgentStore(state, {
      type: "disconnect",
      activity: "Offline",
      conversation: createIdleAtlasAgentConversation(),
      patch: { activity: "Custom offline state", connectError: "keep this" },
    }, { messages: 500, eventLogs: 160, panelWidth: { min: 320, max: 720 } })).toMatchObject({
      connected: false,
      enabled: false,
      silentConnect: false,
      fragmentBootstrap: false,
      activity: "Custom offline state",
      connectError: "keep this",
      conversation: { status: "idle", mcpStatuses: {} },
      bootstrapStatus: null,
      mcpStartupStatuses: {},
    });
  });
});
