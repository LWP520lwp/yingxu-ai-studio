import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CANVAS_SIDE_PANEL_MOTION_MS,
  useCanvasSidePanelStore,
} from "@/stores/use-canvas-side-panel-store";
import {
  CANVAS_AGENT_PANEL_MOTION_MS,
  useAgentStore,
  type AgentChatItem,
} from "@/stores/use-agent-store";

afterEach(() => {
  vi.useRealTimers();
});

describe("canvas panel state", () => {
  it("does not let an earlier close animation unmount a later reopening", () => {
    vi.useFakeTimers();
    const store = useCanvasSidePanelStore;
    store.getState().openPanel();
    store.getState().closePanel();
    vi.advanceTimersByTime(200);
    store.getState().openPanel();
    vi.advanceTimersByTime(200);
    store.getState().closePanel();

    vi.advanceTimersByTime(CANVAS_SIDE_PANEL_MOTION_MS - 200);
    expect(store.getState()).toMatchObject({
      panelOpen: false,
      panelMounted: true,
      panelClosing: true,
    });
    vi.advanceTimersByTime(200);
    expect(store.getState()).toMatchObject({
      panelMounted: false,
      panelClosing: false,
    });
  });

  it("keeps the current agent-panel close timer and bounds retained chat history", () => {
    vi.useFakeTimers();
    const store = useAgentStore;
    store.getState().openPanel();
    store.getState().closePanel();
    vi.advanceTimersByTime(200);
    store.getState().openPanel();
    vi.advanceTimersByTime(200);
    store.getState().closePanel();

    vi.advanceTimersByTime(CANVAS_AGENT_PANEL_MOTION_MS - 200);
    expect(store.getState().panelClosing).toBe(true);
    vi.advanceTimersByTime(200);
    expect(store.getState().panelClosing).toBe(false);

    store.setState({ messages: [] });
    for (let index = 0; index < 510; index += 1) {
      const item: AgentChatItem = {
        id: String(index),
        role: "user",
        text: `message ${index}`,
      };
      store.getState().addMessage(item);
    }
    expect(store.getState().messages).toHaveLength(500);
    expect(store.getState().messages[0]?.id).toBe("10");
    expect(store.getState().messages.at(-1)?.id).toBe("509");
  });

  it("bounds bulk history restores and rejects an invalid panel width", () => {
    const store = useAgentStore;
    store.setState({ messages: [], eventLogs: [], width: 440 });
    const messages: AgentChatItem[] = Array.from({ length: 510 }, (_, index) => ({
      id: String(index),
      role: "assistant",
      text: `message ${index}`,
    }));

    store.getState().setAgentState({ width: 900, messages });
    expect(store.getState().width).toBe(720);
    expect(store.getState().messages).toHaveLength(500);
    expect(store.getState().messages[0]?.id).toBe("10");

    store.getState().setAgentState({ width: Number.NaN });
    expect(store.getState().width).toBe(720);
  });
});
