import { describe, expect, it } from "vitest";
import {
  ATLAS_AGENT_PANEL_TABS,
  normalizeAtlasAgentPanelTab,
} from "@/atlas-engine/agent/panel-model";

describe("Atlas agent panel navigation", () => {
  it("offers chat, setup, history, and logs without a skills-market tab", () => {
    expect(ATLAS_AGENT_PANEL_TABS).toEqual(["chat", "setup", "history", "log"]);
  });

  it("routes legacy skills selection into Chat", () => {
    expect(normalizeAtlasAgentPanelTab("skills")).toBe("chat");
  });
});
