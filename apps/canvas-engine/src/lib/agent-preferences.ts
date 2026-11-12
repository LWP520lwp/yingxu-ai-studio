export type AgentPermissionMode = "request" | "automatic" | "full";
export type AgentReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export type AgentPreferenceSnapshot = {
  url: string;
  token: string;
  permissionMode: AgentPermissionMode;
  model: string;
  reasoningEffort: AgentReasoningEffort | "";
};

export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const DEFAULT_ENDPOINT = "http://127.0.0.1:17371";
const PERMISSION_MODES = new Set<AgentPermissionMode>([
  "request",
  "automatic",
  "full",
]);
const REASONING_LEVELS = new Set<AgentReasoningEffort>([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

export function normalizeAgentEndpoint(value: string) {
  const candidate = value.trim();
  try {
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function readAgentPreferences(
  storage: PreferenceStorage | null,
): AgentPreferenceSnapshot {
  const get = (key: string, fallback: string) => {
    try {
      return storage?.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const permissionMode = get("canvas-agent-permission-mode", "request");
  const reasoningEffort = get("canvas-agent-reasoning-effort", "");

  return {
    url: get("canvas-agent-url", DEFAULT_ENDPOINT),
    token: get("canvas-agent-token", ""),
    permissionMode: PERMISSION_MODES.has(permissionMode as AgentPermissionMode)
      ? (permissionMode as AgentPermissionMode)
      : "request",
    model: get("canvas-agent-model", ""),
    reasoningEffort: REASONING_LEVELS.has(
      reasoningEffort as AgentReasoningEffort,
    )
      ? (reasoningEffort as AgentReasoningEffort)
      : "",
  };
}

export function persistAgentConnection(
  storage: PreferenceStorage | null,
  endpoint: string,
  token: string,
) {
  if (!storage) return false;
  try {
    storage.setItem("canvas-agent-url", endpoint);
    storage.setItem("canvas-agent-token", token);
    return true;
  } catch {
    return false;
  }
}

export function readBrowserAgentPreferences() {
  try {
    return readAgentPreferences(
      typeof window === "undefined" ? null : window.localStorage,
    );
  } catch {
    return readAgentPreferences(null);
  }
}

export function persistBrowserAgentConnection(endpoint: string, token: string) {
  try {
    return persistAgentConnection(
      typeof window === "undefined" ? null : window.localStorage,
      endpoint,
      token,
    );
  } catch {
    return false;
  }
}
