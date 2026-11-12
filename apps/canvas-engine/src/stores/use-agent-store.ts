import { create } from "zustand";
import i18n from "@/i18n";
import {
  normalizeAgentEndpoint,
  persistBrowserAgentConnection,
  readBrowserAgentPreferences,
  type AgentPermissionMode,
  type AgentReasoningEffort,
} from "@/lib/agent-preferences";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";

export interface AgentAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  url: string;
  dataUrl: string;
}

export type AgentMessageAttachment = Pick<AgentAttachment, "id" | "name" | "url"> &
  Partial<Omit<AgentAttachment, "id" | "name" | "url">>;

export type AgentCanvasReference = Pick<
  CanvasResourceReference,
  "nodeId" | "label" | "title" | "kind" | "previewUrl" | "text"
>;

export interface AgentSkillReference {
  name: string;
  path: string;
  displayName?: string;
}

export interface AgentChatItem {
  id: string;
  role: AgentChatRole;
  text: string;
  itemId?: string;
  clientMessageId?: string;
  threadId?: string;
  turnId?: string;
  title?: string;
  meta?: string;
  detail?: unknown;
  attachments?: AgentMessageAttachment[];
  canvasReferences?: AgentCanvasReference[];
  skill?: AgentSkillReference;
  streamId?: string;
  activityItems?: Record<string, string>;
}

export interface AgentEventLog {
  id: string;
  time: string;
  title: string;
  text: string;
  raw?: unknown;
}

export interface AgentPendingToolCall {
  requestId: string;
  name: string;
  input?: { ops?: CanvasAgentOp[]; path?: string } & Record<string, unknown>;
}

export type { AgentPermissionMode, AgentReasoningEffort } from "@/lib/agent-preferences";

export interface AgentModel {
  id: string;
  model: string;
  displayName: string;
  defaultReasoningEffort: AgentReasoningEffort;
  supportedReasoningEfforts: Array<{
    reasoningEffort: AgentReasoningEffort;
    description?: string;
  }>;
  isDefault?: boolean;
}

export type AgentApprovalDecision = "accept" | "acceptForSession" | "decline";

export interface AgentPendingApproval {
  requestId: string;
  method: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  reason?: string;
  command?: unknown;
  cwd?: string;
  grantRoot?: string;
  networkApprovalContext?: unknown;
  permissions?: unknown;
  deciding?: AgentApprovalDecision;
}

export interface AgentCanvasContext {
  snapshot: CanvasAgentSnapshot;
  applyOps(ops?: CanvasAgentOp[]): CanvasAgentSnapshot;
  undoOps(): CanvasAgentSnapshot | null;
  canUndo: boolean;
}

export interface AgentThreadSummary {
  id: string;
  preview: string;
  name?: string | null;
  cwd?: string;
  status?: string;
  source?: unknown;
  createdAt?: number;
  updatedAt?: number;
}

export interface AgentTokenUsage {
  input: number;
  cached: number;
  output: number;
}

export interface AgentBootstrapStatus {
  key: string;
  text: string;
  detail: string;
  status: "running" | "ready" | "error";
}

export interface AgentConversationState {
  revision: number;
  conversationId: string;
  threadId: string;
  status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
  mcpStatuses: Record<
    string,
    { status: "starting" | "ready" | "failed" | "cancelled"; error?: string | null; failureReason?: string | null }
  >;
  sourceClientId?: string;
  error?: string;
}

export type AgentPanelTab = "chat" | "setup" | "history" | "skills" | "log";

interface AgentPanelState {
  width: number;
  panelOpen: boolean;
  panelMounted: boolean;
  panelClosing: boolean;
  activeTab: AgentPanelTab;
}

interface AgentConnectionState {
  url: string;
  token: string;
  connected: boolean;
  enabled: boolean;
  silentConnect: boolean;
  fragmentBootstrap: boolean;
  activity: string;
  connectError: string;
}

interface AgentConversationData {
  canvasContext: AgentCanvasContext | null;
  prompt: string;
  attachments: AgentAttachment[];
  canvasReferences: CanvasResourceReference[];
  sending: boolean;
  waiting: boolean;
  activeThreadId: string;
  activeTurnId: string;
  workspacePath: string;
  loadingThreads: boolean;
  confirmTools: boolean;
  permissionMode: AgentPermissionMode;
  models: AgentModel[];
  model: string;
  reasoningEffort: AgentReasoningEffort | "";
  conversation: AgentConversationState;
  bootstrapStatus: AgentBootstrapStatus | null;
  mcpStartupStatuses: Record<string, AgentBootstrapStatus>;
  pendingTool: AgentPendingToolCall | null;
  pendingApprovals: AgentPendingApproval[];
}

interface AgentRetainedHistory {
  messages: AgentChatItem[];
  tokenUsage: AgentTokenUsage | null;
  eventLogs: AgentEventLog[];
  threads: AgentThreadSummary[];
}

type AgentState = AgentPanelState &
  AgentConnectionState &
  AgentConversationData &
  AgentRetainedHistory;

type AgentStoreActions = {
  setAgentState: (patch: Partial<AgentState>) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setCanvasContext: (context: AgentCanvasContext | null) => void;
  connectAgent: (options?: { silent?: boolean }) => void;
  disconnectAgent: (patch?: Partial<AgentState>) => void;
  addMessage: (item: AgentChatItem) => void;
  addEventLog: (item: AgentEventLog) => void;
  clearEventLogs: () => void;
};

type AgentStore = AgentState & AgentStoreActions;

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

const HISTORY_LIMITS = {
  messages: 500,
  eventLogs: 160,
} as const;

const PANEL_WIDTH = {
  min: 320,
  max: 720,
  default: 440,
  storageKey: "canvas-agent-panel-width",
} as const;

const browserPreferences = readBrowserAgentPreferences();
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let closeRevision = 0;

function keepRecent<T>(items: T[], limit: number) {
  return items.length > limit ? items.slice(items.length - limit) : items;
}

function withAppended<T>(items: T[], item: T, limit: number) {
  return keepRecent([...items, item], limit);
}

function panelWidthFrom(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, value));
}

function readPanelWidth() {
  if (typeof window === "undefined") return PANEL_WIDTH.default;

  try {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH.storageKey));
    if (
      Number.isFinite(stored) &&
      stored >= PANEL_WIDTH.min &&
      stored <= PANEL_WIDTH.max
    ) {
      return stored;
    }
  } catch {
    // Private browsing or storage policy can make localStorage unavailable.
  }

  return PANEL_WIDTH.default;
}

function idleConversation(): AgentConversationState {
  return {
    revision: 0,
    conversationId: "",
    threadId: "",
    status: "idle",
    mcpStatuses: {},
  };
}

function initialAgentState(): AgentState {
  return {
    width: readPanelWidth(),
    panelOpen: false,
    panelMounted: true,
    panelClosing: false,
    activeTab: "setup",

    url: browserPreferences.url,
    token: browserPreferences.token,
    connected: false,
    enabled: false,
    silentConnect: false,
    fragmentBootstrap: false,
    activity: i18n.t("agent.state.ready"),
    connectError: "",

    canvasContext: null,
    prompt: "",
    attachments: [],
    canvasReferences: [],
    sending: false,
    waiting: false,
    activeThreadId: "",
    activeTurnId: "",
    workspacePath: "",
    loadingThreads: false,
    confirmTools: false,
    permissionMode: browserPreferences.permissionMode,
    models: [],
    model: browserPreferences.model,
    reasoningEffort: browserPreferences.reasoningEffort,
    conversation: idleConversation(),
    bootstrapStatus: null,
    mcpStartupStatuses: {},
    pendingTool: null,
    pendingApprovals: [],

    messages: [],
    tokenUsage: null,
    eventLogs: [],
    threads: [],
  };
}

function clearPendingClose() {
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = null;
}

function patchWithinLimits(
  current: AgentState,
  patch: Partial<AgentState>,
): Partial<AgentState> {
  const next = { ...patch };

  if (patch.messages) {
    next.messages = keepRecent(patch.messages, HISTORY_LIMITS.messages);
  }
  if (patch.eventLogs) {
    next.eventLogs = keepRecent(patch.eventLogs, HISTORY_LIMITS.eventLogs);
  }
  if ("width" in patch) {
    next.width = panelWidthFrom(patch.width, current.width);
  }

  return next;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...initialAgentState(),

  setAgentState: (patch) => set((current) => patchWithinLimits(current, patch)),

  openPanel: () => {
    clearPendingClose();
    closeRevision += 1;
    set({ panelOpen: true, panelMounted: true, panelClosing: false });
  },

  closePanel: () => {
    const panel = get();
    if (!panel.panelMounted || !panel.panelOpen || panel.panelClosing) return;

    clearPendingClose();
    const revision = ++closeRevision;
    set({ panelOpen: false, panelClosing: true });

    closeTimer = setTimeout(() => {
      if (revision !== closeRevision) return;
      closeTimer = null;
      if (get().panelClosing && !get().panelOpen) {
        set({ panelClosing: false });
      }
    }, CANVAS_AGENT_PANEL_MOTION_MS);
  },

  togglePanel: () => {
    if (get().panelOpen) get().closePanel();
    else get().openPanel();
  },

  setCanvasContext: (canvasContext) => set({ canvasContext }),

  connectAgent: (options) => {
    const silent = options?.silent ?? false;
    const endpoint = normalizeAgentEndpoint(get().url);
    const token = get().token.trim();

    if (!endpoint || !token) {
      set({
        connectError: silent ? "" : i18n.t("agent.state.connectionRequired"),
      });
      return;
    }

    const persisted = persistBrowserAgentConnection(endpoint, token);
    const connectError = persisted || silent
      ? ""
      : i18n.t("agent.state.storageUnavailable");

    // The mounted agent panel starts its event stream after enabled becomes true.
    set({
      url: endpoint,
      token,
      enabled: true,
      silentConnect: silent,
      fragmentBootstrap: false,
      activity: i18n.t("agent.status.connecting"),
      connectError,
    });
  },

  disconnectAgent: (patch = {}) => {
    set({
      enabled: false,
      connected: false,
      silentConnect: false,
      fragmentBootstrap: false,
      activity: i18n.t("agent.state.offline"),
      conversation: idleConversation(),
      bootstrapStatus: null,
      mcpStartupStatuses: {},
      ...patch,
    });
  },

  addMessage: (item) =>
    set((state) => ({
      messages: withAppended(state.messages, item, HISTORY_LIMITS.messages),
    })),

  addEventLog: (item) =>
    set((state) => ({
      eventLogs: withAppended(state.eventLogs, item, HISTORY_LIMITS.eventLogs),
    })),

  clearEventLogs: () => set({ eventLogs: [] }),
}));
