import type { AgentPanelTab } from "@/stores/use-agent-store";

export const ATLAS_AGENT_PANEL_TABS = [
  "chat",
  "setup",
  "history",
  "log",
] as const satisfies readonly AgentPanelTab[];

export type AtlasAgentPanelTab = (typeof ATLAS_AGENT_PANEL_TABS)[number];

export function normalizeAtlasAgentPanelTab(value: string): AtlasAgentPanelTab {
  return ATLAS_AGENT_PANEL_TABS.includes(value as AtlasAgentPanelTab)
    ? (value as AtlasAgentPanelTab)
    : "chat";
}
