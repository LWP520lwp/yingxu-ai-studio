export interface AgentPanelLifecycle {
  panelOpen: boolean;
  panelMounted: boolean;
  panelClosing: boolean;
}

export type AgentPanelEvent = "open" | "close" | "finish-close";

export interface AgentPanelWidthBounds {
  min: number;
  max: number;
}

export interface AgentHistoryLimits {
  messages: number;
  eventLogs: number;
  panelWidth: AgentPanelWidthBounds;
}

export function transitionAgentPanel<T extends AgentPanelLifecycle>(
  state: T,
  event: AgentPanelEvent,
): T {
  if (event === "open") {
    return {
      ...state,
      panelOpen: true,
      panelMounted: true,
      panelClosing: false,
    };
  }

  if (event === "close") {
    if (!state.panelMounted || !state.panelOpen || state.panelClosing)
      return state;
    return { ...state, panelOpen: false, panelClosing: true };
  }

  if (state.panelClosing && !state.panelOpen) {
    return { ...state, panelClosing: false };
  }
  return state;
}

export function clampAgentPanelWidth(
  value: unknown,
  fallback: number,
  bounds: AgentPanelWidthBounds,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(bounds.min, Math.min(bounds.max, value));
}

export function restoreAgentPanelWidth(
  value: unknown,
  fallback: number,
  bounds: AgentPanelWidthBounds,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < bounds.min ||
    value > bounds.max
  ) {
    return fallback;
  }
  return value;
}

export function keepRecent<T>(items: T[], limit: number): T[] {
  if (limit <= 0) return [];
  return items.length > limit ? items.slice(items.length - limit) : items;
}

export function appendRecent<T>(items: readonly T[], item: T, limit: number) {
  return keepRecent([...items, item], limit);
}

export function constrainAgentStorePatch<
  T extends { width: number; messages: unknown[]; eventLogs: unknown[] },
>(current: T, patch: Partial<T>, limits: AgentHistoryLimits): Partial<T> {
  const next: Partial<T> = { ...patch };

  if (patch.messages) {
    next.messages = keepRecent(
      patch.messages,
      limits.messages,
    ) as T["messages"];
  }
  if (patch.eventLogs) {
    next.eventLogs = keepRecent(
      patch.eventLogs,
      limits.eventLogs,
    ) as T["eventLogs"];
  }
  if ("width" in patch) {
    next.width = clampAgentPanelWidth(
      patch.width,
      current.width,
      limits.panelWidth,
    ) as T["width"];
  }

  return next;
}

export interface AgentConnectionDecisionInput {
  endpoint: string | null;
  token: string;
  silent: boolean;
  persisted: boolean;
  requiredMessage: string;
  storageUnavailableMessage: string;
  connectingMessage: string;
}

export type AgentConnectionDecision =
  | { type: "missing-credentials"; patch: { connectError: string } }
  | {
      type: "connect";
      patch: {
        url: string;
        token: string;
        enabled: true;
        silentConnect: boolean;
        fragmentBootstrap: false;
        activity: string;
        connectError: string;
      };
    };

export function decideAgentConnection(
  input: AgentConnectionDecisionInput,
): AgentConnectionDecision {
  if (!input.endpoint || !input.token) {
    return {
      type: "missing-credentials",
      patch: { connectError: input.silent ? "" : input.requiredMessage },
    };
  }

  return {
    type: "connect",
    patch: {
      url: input.endpoint,
      token: input.token,
      enabled: true,
      silentConnect: input.silent,
      fragmentBootstrap: false,
      activity: input.connectingMessage,
      connectError:
        input.persisted || input.silent ? "" : input.storageUnavailableMessage,
    },
  };
}
