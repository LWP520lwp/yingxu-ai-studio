import { useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Input, Select, Spin } from "antd";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Link2, Square, Terminal } from "lucide-react";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import {
  codexPlanningSnapshot,
  normalizeCodexBridgeEndpoint,
  parseCodexCanvasPlan,
  type CodexCanvasPlan,
} from "./codex-plan";
import "./codex-panel.css";

type Model = { id: string; name: string; isDefault?: boolean };
type Connection = { connected: boolean; accountType: string; models: Model[] };
type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  snapshot: { nodes: CanvasNodeData[]; connections: CanvasConnection[] };
  onApply: (plan: CodexCanvasPlan) => void;
};

function readSaved(key: string, fallback: string) {
  try {
    return sessionStorage.getItem(`yingxu:codex:${key}`) || fallback;
  } catch {
    return fallback;
  }
}

export function CodexStudioPanel({
  open,
  onClose,
  projectId,
  snapshot,
  onApply,
}: Props) {
  const { i18n } = useTranslation();
  const english = i18n.resolvedLanguage?.startsWith("en");
  const tr = (zh: string, en: string) => (english ? en : zh);
  const [endpoint, setEndpoint] = useState(() =>
    readSaved("endpoint", "http://127.0.0.1:4599"),
  );
  const [token, setToken] = useState(() => readSaved("token", ""));
  const [connection, setConnection] = useState<Connection | null>(null);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"connect" | "plan" | null>(null);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<{
    projectId: string;
    plan: CodexCanvasPlan;
  } | null>(null);
  const [applied, setApplied] = useState(false);
  const request = useRef<AbortController | null>(null);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;

  useEffect(() => {
    setProposal(null);
    setApplied(false);
    setError("");
    request.current?.abort();
  }, [projectId]);
  useEffect(() => {
    if (!open) request.current?.abort();
    return () => request.current?.abort();
  }, [open]);

  const fetchBridge = async (
    path: string,
    controller: AbortController,
    body?: unknown,
  ) => {
    const base = normalizeCodexBridgeEndpoint(endpoint);
    if (token.trim().length < 24)
      throw new Error(
        tr(
          "请输入桥接终端中显示的会话令牌",
          "Enter the session token shown in the bridge terminal",
        ),
      );
    const response = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(body ? 200000 : 45000),
      ]),
      credentials: "omit",
      cache: "no-store",
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        typeof value.error === "string"
          ? value.error
          : `Bridge HTTP ${response.status}`,
      );
    return value;
  };

  const connect = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy("connect");
    setError("");
    setConnection(null);
    try {
      const value = (await fetchBridge("/health", controller)) as Connection;
      if (controller.signal.aborted) return;
      if (
        !Array.isArray(value.models) ||
        !value.models.every(
          (entry) =>
            typeof entry.id === "string" && typeof entry.name === "string",
        )
      )
        throw new Error(
          tr(
            "桥接服务未返回有效模型列表",
            "The bridge did not return a valid model list",
          ),
        );
      setConnection(value);
      setModel(
        value.models.find((entry) => entry.isDefault)?.id ||
          value.models[0]?.id ||
          "",
      );
      if (!value.connected)
        setError(
          tr(
            "请先在本机终端运行 codex login，再重新连接",
            "Run codex login in your local terminal, then reconnect",
          ),
        );
      try {
        sessionStorage.setItem(
          "yingxu:codex:endpoint",
          normalizeCodexBridgeEndpoint(endpoint),
        );
        sessionStorage.setItem("yingxu:codex:token", token.trim());
      } catch {
        /* connection still works without browser persistence */
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : tr("无法连接本机 Codex", "Could not connect to local Codex"),
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(null);
      }
    }
  };

  const plan = async () => {
    if (!prompt.trim() || !connection?.connected || !model) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const owner = projectId;
    setBusy("plan");
    setError("");
    setProposal(null);
    setApplied(false);
    try {
      const result = await fetchBridge("/turn", controller, {
        prompt: prompt.trim(),
        model,
        snapshot: codexPlanningSnapshot(snapshot),
      });
      if (controller.signal.aborted || currentProject.current !== owner) return;
      setProposal({
        projectId: owner,
        plan: parseCodexCanvasPlan(result.plan),
      });
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : tr("Codex 规划未完成", "Codex planning did not complete"),
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(null);
      }
    }
  };

  const updateConnection = (field: "endpoint" | "token", value: string) => {
    request.current?.abort();
    setConnection(null);
    setProposal(null);
    setError("");
    if (field === "endpoint") setEndpoint(value);
    else setToken(value);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={440}
      title={
        <span className="codex-studio-title">
          <Terminal size={18} aria-hidden />
          Codex Studio
        </span>
      }
      rootClassName="codex-studio-drawer"
      destroyOnHidden={false}
    >
      <div className="codex-studio-intro">
        <span className="codex-studio-eyebrow">CANVAS DIRECTOR</span>
        <h2>
          {tr(
            "把想法变成可编辑的分镜。",
            "Turn an idea into an editable sequence.",
          )}
        </h2>
        <p>
          {tr(
            "连接你本机已登录的 Codex，让它读取文字上下文、规划节点与连接。预览确认后再加入画布。",
            "Connect your signed-in local Codex to plan nodes and connections from the canvas text. Preview the proposal before adding it.",
          )}
        </p>
      </div>

      <details
        className="codex-studio-connection"
        open={!connection?.connected}
      >
        <summary>
          <Link2 size={15} aria-hidden />
          {tr("本机连接", "Local connection")}
          <span>
            {connection?.connected
              ? tr("已连接", "Connected")
              : tr("未连接", "Disconnected")}
          </span>
        </summary>
        <div className="codex-studio-fields">
          <label>
            {tr("桥接地址", "Bridge address")}
            <Input
              value={endpoint}
              onChange={(event) =>
                updateConnection("endpoint", event.target.value)
              }
              placeholder="http://127.0.0.1:4599"
              autoComplete="off"
            />
          </label>
          <label>
            {tr("本次会话令牌", "Session token")}
            <Input.Password
              value={token}
              onChange={(event) =>
                updateConnection("token", event.target.value)
              }
              autoComplete="off"
            />
          </label>
          <Button
            onClick={() => void connect()}
            loading={busy === "connect"}
            disabled={busy === "plan"}
          >
            {tr("连接并读取模型", "Connect and load models")}
          </Button>
          <p>
            {tr(
              "在项目目录运行 npm run codex:bridge。令牌显示在本机终端中，仅保存到当前浏览器会话。",
              "Run npm run codex:bridge in the project. The local terminal shows the token, which is stored only for this browser session.",
            )}
          </p>
        </div>
      </details>

      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          closable
          onClose={() => setError("")}
        />
      )}

      <div className="codex-studio-composer">
        <label htmlFor="codex-studio-model">
          {tr("规划模型", "Planning model")}
        </label>
        <Select
          id="codex-studio-model"
          value={model || undefined}
          onChange={setModel}
          disabled={!connection?.connected || Boolean(busy)}
          options={
            connection?.models.map((entry) => ({
              value: entry.id,
              label: entry.name,
            })) || []
          }
          placeholder={tr(
            "连接后读取可用模型",
            "Connect to load available models",
          )}
        />
        <label htmlFor="codex-studio-prompt">
          {tr("这次想创作什么？", "What would you like to make?")}
        </label>
        <Input.TextArea
          id="codex-studio-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
          maxLength={12000}
          placeholder={tr(
            "例如：把选题整理成五个连续镜头，为人物、场景和视频生成各建一个节点，并连接引用。",
            "For example: plan five connected shots with reusable character, scene and video-generation nodes.",
          )}
          disabled={busy === "plan"}
        />
        <div className="codex-studio-submit">
          <span>
            {tr(
              "保留已有节点，新增方案可撤销",
              "Existing nodes stay intact; additions are undoable",
            )}
          </span>
          {busy === "plan" ? (
            <Button
              icon={<Square size={14} />}
              onClick={() => request.current?.abort()}
            >
              {tr("停止", "Stop")}
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<ArrowRight size={15} />}
              disabled={
                !connection?.connected ||
                !model ||
                !prompt.trim() ||
                Boolean(busy)
              }
              onClick={() => void plan()}
            >
              {tr("规划画布", "Plan canvas")}
            </Button>
          )}
        </div>
      </div>

      {busy === "plan" && (
        <div className="codex-studio-pending" role="status">
          <Spin size="small" />
          {tr(
            "Codex 正在组织镜头和生成指令…",
            "Codex is arranging shots and generation instructions…",
          )}
        </div>
      )}

      {proposal?.projectId === projectId && (
        <section
          className="codex-studio-proposal"
          aria-label={tr("方案预览", "Plan preview")}
        >
          <div className="codex-studio-proposal-heading">
            <h3>{tr("方案预览", "Plan preview")}</h3>
            <span>
              {proposal.plan.nodes.length} {tr("个节点", "nodes")} ·{" "}
              {proposal.plan.connections.length} {tr("条连接", "connections")}
            </span>
          </div>
          <p>{proposal.plan.summary}</p>
          <ol>
            {proposal.plan.nodes.map((node) => (
              <li key={node.id}>
                <span>{node.type.toUpperCase()}</span>
                <strong>{node.title}</strong>
                <p>{node.content || node.prompt}</p>
              </li>
            ))}
          </ol>
          <Button
            block
            type="primary"
            disabled={applied}
            icon={<Check size={15} />}
            onClick={() => {
              onApply(proposal.plan);
              setApplied(true);
            }}
          >
            {applied
              ? tr("已加入画布", "Added to canvas")
              : tr("确认加入画布", "Add proposal to canvas")}
          </Button>
          <p className="codex-studio-footnote">
            {tr(
              "这里只新增文字和配置。图片、视频由你在画布中确认后生成，使用对应账号的额度。",
              "This adds text and configuration only. Generate images or videos separately in the canvas using the selected provider account.",
            )}
          </p>
        </section>
      )}
    </Drawer>
  );
}
