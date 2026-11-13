import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Clock3,
  MessageSquareText,
  ScrollText,
  Settings2,
  X,
} from "lucide-react";

import {
  normalizeAgentEndpoint,
  persistBrowserAgentConnection,
} from "@/lib/agent-preferences";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import {
  ATLAS_AGENT_PANEL_TABS,
  normalizeAtlasAgentPanelTab,
} from "./panel-model";

const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 720;
const PANEL_TOP = 56;

export function AtlasAgentPanel() {
  const { t } = useTranslation();
  const colorTheme = useThemeStore((state) => state.theme);
  const theme = canvasThemes[colorTheme];
  const panelOpen = useAgentStore((state) => state.panelOpen);
  const panelMounted = useAgentStore((state) => state.panelMounted);
  const panelClosing = useAgentStore((state) => state.panelClosing);
  const width = useAgentStore((state) => state.width);
  const activeTab = useAgentStore((state) => state.activeTab);
  const connected = useAgentStore((state) => state.connected);
  const enabled = useAgentStore((state) => state.enabled);
  const activity = useAgentStore((state) => state.activity);
  const url = useAgentStore((state) => state.url);
  const token = useAgentStore((state) => state.token);
  const connectError = useAgentStore((state) => state.connectError);
  const messages = useAgentStore((state) => state.messages);
  const threads = useAgentStore((state) => state.threads);
  const eventLogs = useAgentStore((state) => state.eventLogs);
  const closePanel = useAgentStore((state) => state.closePanel);
  const setAgentState = useAgentStore((state) => state.setAgentState);
  const clearEventLogs = useAgentStore((state) => state.clearEventLogs);
  const [endpointDraft, setEndpointDraft] = useState(url);
  const [tokenDraft, setTokenDraft] = useState(token);
  const [saveNotice, setSaveNotice] = useState("");
  const resizeStart = useRef<{
    pointerId: number;
    x: number;
    width: number;
  } | null>(null);
  const wasOpen = useRef(false);

  const selectedTab = normalizeAtlasAgentPanelTab(activeTab);

  useEffect(() => {
    if (panelOpen && !wasOpen.current) {
      setEndpointDraft(url);
      setTokenDraft(token);
      setSaveNotice("");
      setAgentState({ activeTab: "chat" });
    }
    wasOpen.current = panelOpen;
  }, [panelOpen, setAgentState, token, url]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePanel, panelOpen]);

  const selectTab = useCallback(
    (tab: (typeof ATLAS_AGENT_PANEL_TABS)[number]) => {
      setAgentState({ activeTab: tab });
    },
    [setAgentState],
  );

  const savePreferences = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const endpoint = normalizeAgentEndpoint(endpointDraft);
      const accessToken = tokenDraft.trim();
      if (!endpoint || !accessToken) {
        setSaveNotice("");
        setAgentState({ connectError: t("agent.state.connectionRequired") });
        return;
      }

      const persisted = persistBrowserAgentConnection(endpoint, accessToken);
      setAgentState({
        url: endpoint,
        token: accessToken,
        connectError: persisted ? "" : t("agent.state.storageUnavailable"),
      });
      setEndpointDraft(endpoint);
      setTokenDraft(accessToken);
      setSaveNotice(t("agent.panel.preferencesSaved"));
    },
    [endpointDraft, setAgentState, t, tokenDraft],
  );

  const resizeDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizeMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setAgentState({ width: start.width + start.x - event.clientX });
  };
  const resizeEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeStart.current?.pointerId === event.pointerId)
      resizeStart.current = null;
  };
  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setAgentState({ width: width + (event.key === "ArrowLeft" ? 16 : -16) });
  };

  if (!panelMounted || (!panelOpen && !panelClosing)) return null;

  const tabItems = [
    { id: "chat", label: t("agent.panel.chat"), Icon: MessageSquareText },
    { id: "setup", label: t("agent.panel.setup"), Icon: Settings2 },
    { id: "history", label: t("agent.panel.history"), Icon: Clock3 },
    { id: "log", label: t("agent.panel.logs"), Icon: ScrollText },
  ] as const;
  const status = connected
    ? t("agent.status.connected")
    : enabled
      ? t("agent.status.connecting")
      : t("agent.status.disconnected");

  return (
    <>
      <button
        type="button"
        tabIndex={panelOpen ? 0 : -1}
        aria-label={t("common.close")}
        aria-hidden={!panelOpen}
        className="fixed inset-x-0 bottom-0 z-[120] border-0 p-0 transition-opacity duration-200"
        style={{
          top: PANEL_TOP,
          opacity: panelOpen ? 1 : 0,
          pointerEvents: panelOpen ? "auto" : "none",
          background: "rgba(5, 10, 9, 0.34)",
        }}
        onClick={closePanel}
      />
      <aside
        role="dialog"
        aria-label={t("agent.panel.title")}
        aria-modal={panelOpen}
        aria-hidden={!panelOpen}
        className="fixed bottom-0 right-0 z-[121] flex flex-col border-l shadow-2xl transition-transform duration-200 ease-out"
        style={{
          top: PANEL_TOP,
          width: `min(${width}px, 100vw)`,
          maxWidth: "100vw",
          transform: panelOpen ? "translateX(0)" : "translateX(100%)",
          background: theme.node.panel,
          color: theme.node.text,
          borderColor: theme.toolbar.border,
          pointerEvents: panelOpen ? "auto" : "none",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          role="separator"
          aria-label={t("agent.panel.resize")}
          aria-orientation="vertical"
          aria-valuemin={MIN_PANEL_WIDTH}
          aria-valuemax={MAX_PANEL_WIDTH}
          aria-valuenow={width}
          tabIndex={panelOpen ? 0 : -1}
          className="absolute bottom-0 left-0 top-0 z-10 flex w-3 cursor-col-resize items-center justify-center outline-none focus-visible:ring-2"
          onPointerDown={resizeDown}
          onPointerMove={resizeMove}
          onPointerUp={resizeEnd}
          onPointerCancel={resizeEnd}
          onKeyDown={resizeByKeyboard}
        >
          <span
            className="h-9 w-0.5 rounded-full"
            style={{ background: theme.toolbar.border }}
          />
        </div>
        <header
          className="flex h-14 shrink-0 items-center justify-between border-b px-5"
          style={{ borderColor: theme.toolbar.border }}
        >
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {t("agent.panel.title")}
            </h2>
            <div
              className="mt-0.5 flex items-center gap-2 text-xs"
              style={{ color: theme.node.muted }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{
                  background: connected
                    ? "#3a9870"
                    : enabled
                      ? "#d5a64c"
                      : theme.node.faint,
                }}
              />
              <span className="truncate">
                {status}
                {activity ? ` · ${activity}` : ""}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded border bg-transparent"
            style={{
              color: theme.node.muted,
              borderColor: theme.toolbar.border,
            }}
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={closePanel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div
          role="tablist"
          aria-label={t("agent.panel.title")}
          className="flex shrink-0 gap-1 border-b px-4 py-2"
          style={{ borderColor: theme.toolbar.border }}
        >
          {tabItems.map(({ id, label, Icon }) => {
            const selected = selectedTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`atlas-agent-tab-${id}`}
                className="flex h-9 min-w-0 items-center gap-2 rounded px-3 text-xs font-medium transition-colors"
                style={{
                  color: selected
                    ? theme.toolbar.activeText
                    : theme.toolbar.item,
                  background: selected ? theme.toolbar.activeBg : "transparent",
                  border: `1px solid ${selected ? theme.toolbar.border : "transparent"}`,
                }}
                onClick={() => selectTab(id)}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {selectedTab === "chat" && (
            <section
              id="atlas-agent-tab-chat"
              role="tabpanel"
              aria-label={t("agent.panel.chat")}
              className="flex h-full min-h-0 flex-col"
            >
              <div
                className="shrink-0 border-b px-5 py-3 text-xs leading-5"
                style={{
                  borderColor: theme.toolbar.border,
                  color: theme.node.muted,
                }}
              >
                {t("agent.panel.transportUnavailable")}
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
                role="log"
                aria-label={t("canvas.agentPanel.agentMessages")}
              >
                {messages.length === 0 ? (
                  <div className="grid h-full min-h-40 place-content-center gap-2 text-center">
                    <MessageSquareText
                      className="mx-auto"
                      size={20}
                      style={{ color: theme.node.faint }}
                      aria-hidden="true"
                    />
                    <p
                      className="m-0 text-sm"
                      style={{ color: theme.node.muted }}
                    >
                      {t("agent.panel.emptyChat")}
                    </p>
                    {!connected && (
                      <p
                        className="m-0 max-w-xs text-xs leading-5"
                        style={{ color: theme.node.faint }}
                      >
                        {t("agent.history.connectHint")}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {messages.map((message) => (
                      <article
                        key={message.id}
                        className="border-b pb-3"
                        style={{ borderColor: theme.toolbar.border }}
                      >
                        <div
                          className="mb-1 text-[11px] font-semibold"
                          style={{ color: theme.node.muted }}
                        >
                          {t(`agent.panel.${message.role}`)}
                        </div>
                        <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6">
                          {message.text}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {selectedTab === "setup" && (
            <section
              id="atlas-agent-tab-setup"
              role="tabpanel"
              aria-label={t("agent.panel.setup")}
              className="h-full overflow-y-auto px-5 py-5"
            >
              <p
                className="mb-5 text-sm leading-6"
                style={{ color: theme.node.muted }}
              >
                {t("agent.panel.setupDescription")}
              </p>
              <form className="grid gap-4" onSubmit={savePreferences}>
                <label className="grid gap-1.5 text-xs font-medium">
                  <span>{t("agent.panel.endpoint")}</span>
                  <input
                    type="url"
                    autoComplete="url"
                    value={endpointDraft}
                    onChange={(event) => {
                      setEndpointDraft(event.target.value);
                      setSaveNotice("");
                      setAgentState({ connectError: "" });
                    }}
                    placeholder="http://127.0.0.1:17371"
                    className="h-10 w-full rounded border bg-transparent px-3 text-sm outline-none focus-visible:ring-2"
                    style={{
                      borderColor: theme.toolbar.border,
                      color: theme.node.text,
                    }}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium">
                  <span>{t("agent.panel.token")}</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={tokenDraft}
                    onChange={(event) => {
                      setTokenDraft(event.target.value);
                      setSaveNotice("");
                      setAgentState({ connectError: "" });
                    }}
                    placeholder="••••••••"
                    className="h-10 w-full rounded border bg-transparent px-3 text-sm outline-none focus-visible:ring-2"
                    style={{
                      borderColor: theme.toolbar.border,
                      color: theme.node.text,
                    }}
                  />
                </label>
                {(connectError || saveNotice) && (
                  <p
                    role={connectError ? "alert" : "status"}
                    className="m-0 text-xs leading-5"
                    style={{ color: connectError ? "#c75c48" : "#37856b" }}
                  >
                    {connectError || saveNotice}
                  </p>
                )}
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded border px-4 text-sm font-medium"
                  style={{
                    borderColor: theme.toolbar.border,
                    background: theme.toolbar.activeBg,
                    color: theme.toolbar.activeText,
                  }}
                >
                  <Settings2 size={15} aria-hidden="true" />
                  {t("agent.panel.savePreferences")}
                </button>
              </form>
            </section>
          )}

          {selectedTab === "history" && (
            <section
              id="atlas-agent-tab-history"
              role="tabpanel"
              aria-label={t("agent.panel.history")}
              className="h-full overflow-y-auto px-5 py-4"
            >
              {threads.length === 0 ? (
                <div className="grid h-full min-h-40 place-content-center gap-2 text-center">
                  <Clock3
                    className="mx-auto"
                    size={20}
                    style={{ color: theme.node.faint }}
                    aria-hidden="true"
                  />
                  <p
                    className="m-0 text-sm"
                    style={{ color: theme.node.muted }}
                  >
                    {t("agent.panel.emptyHistory")}
                  </p>
                  {!connected && (
                    <p
                      className="m-0 max-w-xs text-xs leading-5"
                      style={{ color: theme.node.faint }}
                    >
                      {t("agent.history.connectHint")}
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-3">
                  {threads.map((thread) => (
                    <article
                      key={thread.id}
                      className="border-b pb-3"
                      style={{ borderColor: theme.toolbar.border }}
                    >
                      <h3 className="m-0 truncate text-sm font-medium">
                        {thread.name || t("agent.history.untitled")}
                      </h3>
                      <p
                        className="mb-0 mt-1 line-clamp-2 text-xs leading-5"
                        style={{ color: theme.node.muted }}
                      >
                        {thread.preview}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {selectedTab === "log" && (
            <section
              id="atlas-agent-tab-log"
              role="tabpanel"
              aria-label={t("agent.panel.logs")}
              className="flex h-full min-h-0 flex-col"
            >
              <div
                className="flex shrink-0 items-center justify-between border-b px-5 py-2"
                style={{ borderColor: theme.toolbar.border }}
              >
                <span className="text-xs" style={{ color: theme.node.muted }}>
                  {t("agent.history.count", { count: eventLogs.length })}
                </span>
                {eventLogs.length > 0 && (
                  <button
                    type="button"
                    className="h-8 rounded px-2 text-xs"
                    style={{ color: theme.node.muted }}
                    onClick={clearEventLogs}
                  >
                    {t("agent.history.deleteCount", {
                      count: eventLogs.length,
                    })}
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {eventLogs.length === 0 ? (
                  <div className="grid h-full min-h-40 place-content-center gap-2 text-center">
                    <ScrollText
                      className="mx-auto"
                      size={20}
                      style={{ color: theme.node.faint }}
                      aria-hidden="true"
                    />
                    <p
                      className="m-0 text-sm"
                      style={{ color: theme.node.muted }}
                    >
                      {t("agent.panel.emptyLogs")}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {eventLogs.map((item) => (
                      <article
                        key={item.id}
                        className="border-b pb-3"
                        style={{ borderColor: theme.toolbar.border }}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="m-0 truncate text-xs font-semibold">
                            {item.title}
                          </h3>
                          <time
                            className="shrink-0 text-[10px]"
                            style={{ color: theme.node.faint }}
                          >
                            {item.time}
                          </time>
                        </div>
                        <p
                          className="mb-0 mt-1 whitespace-pre-wrap break-words text-xs leading-5"
                          style={{ color: theme.node.muted }}
                        >
                          {item.text}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
