import { create } from "zustand";
import i18n from "@/i18n";
import {
  normalizeAgentEndpoint,
  persistBrowserAgentConnection,
  readBrowserAgentPreferences,
  type AgentPermissionMode,
  type AgentReasoningEffort,
} from "@/lib/agent-preferences";
import {
  createIdleAtlasAgentConversation,
  decideAgentConnection,
  reduceAtlasAgentStore,
  restoreAgentPanelWidth,
  transitionAgentPanel,
  type AtlasAgentConversation,
} from "@/atlas-engine/agent/store-state";
import type {
  CanvasAgentOp,
  CanvasAgentSnapshot,
} from "@/atlas-engine/agent/canvas-operations";
import type { CanvasResourceReference } from "@/atlas-engine/model/resource-references";

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

export type AgentMessageAttachment = Pick<
  AgentAttachment,
  "id" | "name" | "url"
> &
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

export type {
  AgentPermissionMode,
  AgentReasoningEffort,
} from "@/lib/agent-preferences";

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

export type AgentConversationState = AtlasAgentConversation;

export type AgentPanelTab = "chat" | "setup" | "history" | "log";

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

function readPanelWidth() {
  if (typeof window === "undefined") return PANEL_WIDTH.default;

  try {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH.storageKey));
    return restoreAgentPanelWidth(stored, PANEL_WIDTH.default, PANEL_WIDTH);
  } catch {
    // Private browsing or storage policy can make localStorage unavailable.
  }

  return PANEL_WIDTH.default;
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
    conversation: createIdleAtlasAgentConversation(),
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

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...initialAgentState(),

  setAgentState: (patch) =>
    set((current) =>
      reduceAtlasAgentStore(current, { type: "patch", patch }, {
        ...HISTORY_LIMITS,
        panelWidth: PANEL_WIDTH,
      }),
    ),

  openPanel: () => {
    clearPendingClose();
    closeRevision += 1;
    set((state) => reduceAtlasAgentStore(state, {
      type: "panel",
      transition: "open",
    }, { ...HISTORY_LIMITS, panelWidth: PANEL_WIDTH }));
  },

  closePanel: () => {
    const panel = get();
    const closing = transitionAgentPanel(panel, "close");
    if (closing === panel) return;

    clearPendingClose();
    const revision = ++closeRevision;
    set(closing);

    closeTimer = setTimeout(() => {
      if (revision !== closeRevision) return;
      closeTimer = null;
      set((state) => reduceAtlasAgentStore(state, {
        type: "panel",
        transition: "finish-close",
      }, { ...HISTORY_LIMITS, panelWidth: PANEL_WIDTH }));
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
    const persisted =
      endpoint && token
        ? persistBrowserAgentConnection(endpoint, token)
        : false;
    const decision = decideAgentConnection({
      endpoint,
      token,
      silent,
      persisted,
      requiredMessage: i18n.t("agent.state.connectionRequired"),
      storageUnavailableMessage: i18n.t("agent.state.storageUnavailable"),
      connectingMessage: i18n.t("agent.status.connecting"),
    });

    // The mounted panel starts its event stream after enabled becomes true.
    set(decision.patch);
  },

  disconnectAgent: (patch = {}) => {
    set((state) => reduceAtlasAgentStore(state, {
      type: "disconnect",
      activity: i18n.t("agent.state.offline"),
      conversation: createIdleAtlasAgentConversation(),
      patch,
    }, { ...HISTORY_LIMITS, panelWidth: PANEL_WIDTH }));
  },

  addMessage: (item) =>
    set((state) => reduceAtlasAgentStore(state, {
      type: "message",
      item,
    }, { ...HISTORY_LIMITS, panelWidth: PANEL_WIDTH })),

  addEventLog: (item) =>
    set((state) => reduceAtlasAgentStore(state, {
      type: "event",
      item,
    }, { ...HISTORY_LIMITS, panelWidth: PANEL_WIDTH })),

  clearEventLogs: () => set((state) => reduceAtlasAgentStore(state, {
    type: "clear-events",
  }, { ...HISTORY_LIMITS, panelWidth: PANEL_WIDTH })),
}));
