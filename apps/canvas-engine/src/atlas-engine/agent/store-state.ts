export type AtlasPanelState = {
  panelOpen: boolean;
  panelMounted: boolean;
  panelClosing: boolean;
};

export type AtlasPanelTransition = "open" | "close" | "finish-close";

export type AtlasHistoryLimits = {
  messages: number;
  eventLogs: number;
  panelWidth: { min: number; max: number };
};

export type AtlasAgentConversation = {
  revision: number;
  conversationId: string;
  threadId: string;
  status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
  mcpStatuses: Record<string, {
    status: "starting" | "ready" | "failed" | "cancelled";
    error?: string | null;
    failureReason?: string | null;
  }>;
  sourceClientId?: string;
  error?: string;
};

export type AtlasAgentBootstrapStatus = {
  key: string;
  text: string;
  detail: string;
  status: "running" | "ready" | "error";
};

export type AtlasAgentStoreState<TMessage, TEvent> = AtlasPanelState & {
  width: number;
  messages: TMessage[];
  eventLogs: TEvent[];
  connected: boolean;
  enabled: boolean;
  silentConnect: boolean;
  fragmentBootstrap: boolean;
  activity: string;
  connectError: string;
  conversation: AtlasAgentConversation;
  bootstrapStatus: AtlasAgentBootstrapStatus | null;
  mcpStartupStatuses: Record<string, AtlasAgentBootstrapStatus>;
};

export type AtlasAgentStoreEvent<TMessage, TLog> =
  | { type: "patch"; patch: Partial<AtlasAgentStoreState<TMessage, TLog>> }
  | { type: "panel"; transition: AtlasPanelTransition }
  | {
      type: "disconnect";
      activity: string;
      conversation: AtlasAgentConversation;
      patch?: Partial<AtlasAgentStoreState<TMessage, TLog>>;
    }
  | { type: "message"; item: TMessage }
  | { type: "event"; item: TLog }
  | { type: "clear-events" };

export function createIdleAtlasAgentConversation(): AtlasAgentConversation {
  return {
    revision: 0,
    conversationId: "",
    threadId: "",
    status: "idle",
    mcpStatuses: {},
  };
}

export function transitionAgentPanel<T extends AtlasPanelState>(
  state: T,
  action: AtlasPanelTransition,
): T {
  if (action === "open") {
    if (state.panelOpen && state.panelMounted && !state.panelClosing) return state;
    return { ...state, panelOpen: true, panelMounted: true, panelClosing: false };
  }

  if (action === "close") {
    if (!state.panelOpen || state.panelClosing) return state;
    return { ...state, panelOpen: false, panelMounted: true, panelClosing: true };
  }

  if (state.panelOpen || !state.panelClosing) return state;
  return { ...state, panelOpen: false, panelMounted: true, panelClosing: false };
}

export function appendRecent<T>(items: readonly T[], item: T, limit: number): T[] {
  const capacity = finiteLimit(limit);
  return capacity === 0 ? [] : [...items, item].slice(-capacity);
}

export function constrainAgentStorePatch<T extends {
  width: number;
  messages: unknown[];
  eventLogs: unknown[];
}>(
  current: T,
  patch: Partial<T>,
  limits: AtlasHistoryLimits,
): Partial<T> {
  const next: Partial<T> = { ...patch };
  if (Object.hasOwn(patch, "width")) {
    next.width = clampAgentPanelWidth(patch.width, current.width, limits.panelWidth);
  }
  if (Array.isArray(patch.messages)) {
    next.messages = retainLatest(patch.messages, limits.messages);
  }
  if (Array.isArray(patch.eventLogs)) {
    next.eventLogs = retainLatest(patch.eventLogs, limits.eventLogs);
  }
  return next;
}

export function reduceAtlasAgentStore<TMessage, TLog>(
  state: AtlasAgentStoreState<TMessage, TLog>,
  event: AtlasAgentStoreEvent<TMessage, TLog>,
  limits: AtlasHistoryLimits,
): Partial<AtlasAgentStoreState<TMessage, TLog>> {
  switch (event.type) {
    case "patch":
      return constrainAgentStorePatch(state, event.patch, limits);
    case "panel":
      return transitionAgentPanel(state, event.transition);
    case "disconnect":
      return {
        enabled: false,
        connected: false,
        silentConnect: false,
        fragmentBootstrap: false,
        activity: event.activity,
        conversation: event.conversation,
        bootstrapStatus: null,
        mcpStartupStatuses: {},
        ...constrainAgentStorePatch(state, event.patch ?? {}, limits),
      };
    case "message":
      return { messages: appendRecent(state.messages, event.item, limits.messages) };
    case "event":
      return { eventLogs: appendRecent(state.eventLogs, event.item, limits.eventLogs) };
    case "clear-events":
      return { eventLogs: [] };
  }
}

export function restoreAgentPanelWidth(
  saved: number,
  current: number,
  range: { min: number; max: number },
) {
  return Number.isFinite(saved) && saved >= range.min && saved <= range.max
    ? saved
    : current;
}

export function clampAgentPanelWidth(
  value: unknown,
  fallback: number,
  range: { min: number; max: number },
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(range.min, Math.min(range.max, value));
}

type ConnectionDecisionInput = {
  endpoint: string | null;
  token: string;
  silent: boolean;
  persisted: boolean;
  requiredMessage: string;
  storageUnavailableMessage: string;
  connectingMessage: string;
};

export type AtlasConnectionDecision =
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

export function decideAgentConnection(input: ConnectionDecisionInput): AtlasConnectionDecision {
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
      connectError: input.silent || input.persisted ? "" : input.storageUnavailableMessage,
    },
  };
}

function finiteLimit(limit: number) {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

function retainLatest<T>(items: readonly T[], limit: number): T[] {
  const capacity = finiteLimit(limit);
  return capacity === 0 ? [] : items.slice(-capacity);
}
