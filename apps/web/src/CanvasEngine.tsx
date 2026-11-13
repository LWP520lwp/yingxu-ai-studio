import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, ApiError, json, message } from "./api";
import type { Asset, Bootstrap, CanvasDocument, Job, Project } from "./types";
import { installCanvasVideoSkill, listCanvasVideoSkills, prepareCanvasVideoPrompt, prepareCanvasVideoSkill, readCanvasVideoSkill } from "./canvasSkills";

export type CanvasEngineHandle = { command: (command: string, payload?: unknown) => void; request: (command: string, payload?: unknown) => Promise<boolean>; flush: () => Promise<boolean>; isReady: () => boolean };
export type CanvasPlatformAction = "home" | "projects" | "newProject" | "skills" | "skillImport" | "workflow" | "pool" | "settings";

export function parseCanvasPlatformAction(value: unknown): CanvasPlatformAction {
  if (value === "home" || value === "projects" || value === "newProject" || value === "skills" || value === "skillImport" || value === "workflow" || value === "pool" || value === "settings") return value;
  throw new Error("此画布入口尚未接入工作台");
}

type CanvasCommand = { command: string; payload?: unknown; id?: string };
/** Native draft names take precedence over the legacy project's shared title. */
export function canvasInitialTitle(snapshot: unknown, fallback: string): string {
  const document = snapshot && typeof snapshot === "object" ? (snapshot as { document?: unknown }).document : null;
  const title = document && typeof document === "object" ? (document as { title?: unknown }).title : null;
  return (typeof title === "string" && title.trim() ? title : fallback).trim().slice(0, 200);
}
/** A channel belongs to one iframe scope; queued commands never survive its disposal. */
export function createCanvasCommandChannel(options: {
  scopeId: string;
  send: (message: Record<string, unknown>) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  timeoutMs?: number;
}) {
  let ready = false;
  let active = true;
  let queued: CanvasCommand[] = [];
  const requests = new Map<string, { command: string; resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  const settleRequest = (id: string, ok: boolean, error?: string) => {
    const request = requests.get(id);
    if (!request) return;
    requests.delete(id);
    clearTimeout(request.timer);
    queued = queued.filter((item) => item.id !== id);
    if (error && active) options.onError(error);
    request.resolve(ok);
  };
  let pending: { id: string; promise: Promise<boolean>; resolve: (saved: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const send = (command: CanvasCommand) => {
    if (active) options.send({ type: "frameflow:command", scopeId: options.scopeId, ...command });
  };
  const settle = (saved: boolean, error?: string) => {
    if (!pending) return;
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    queued = queued.filter((command) => command.id !== request.id);
    if (error && active) options.onError(error);
    if (saved && active) options.onStatus("画布已确认保存");
    request.resolve(saved);
  };
  const flush = (): Promise<boolean> => {
    if (!active) return Promise.resolve(false);
    if (pending) return pending.promise;
    const id = crypto.randomUUID();
    let resolve: (saved: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((done) => { resolve = done; });
    pending = { id, promise, resolve, timer: setTimeout(() => settle(false, "画布保存确认超时，请留在当前项目重试保存"), options.timeoutMs ?? 45_000) };
    options.onStatus(ready ? "正在确认画布保存…" : "正在等待画布就绪并保存…");
    const command = { id, command: "flush" };
    if (ready) send(command);
    else queued.push(command);
    return promise;
  };
  return {
    flush,
    isReady: () => active && ready,
    request(command: string, payload?: unknown): Promise<boolean> {
      if (!active) return Promise.resolve(false);
      const id = crypto.randomUUID();
      return new Promise((resolve) => {
        requests.set(id, { command, resolve, timer: setTimeout(() => settleRequest(id, false, "画布操作确认超时，请检查当前画布后重试"), options.timeoutMs ?? 45_000) });
        if (ready) send({ command, payload, id });
        else queued.push({ command, payload, id });
      });
    },
    command(command: string, payload?: unknown) {
      if (!active) return;
      if (command === "save" || command === "flush") { void flush(); return; }
      if (ready) send({ command, payload });
      else queued.push({ command, payload });
    },
    markMounted() {
      if (!active || ready) return;
      ready = true;
      const commands = queued;
      queued = [];
      for (const command of commands) send(command);
    },
    receive(value: unknown) {
      if (!active || !value || typeof value !== "object") return;
      const response = value as { type?: string; scopeId?: string; id?: string; command?: string; ok?: boolean; result?: { saved?: boolean }; error?: { message?: string } };
      if (response.type !== "frameflow:command-response" || response.scopeId !== options.scopeId) return;
      const request = response.id ? requests.get(response.id) : undefined;
      if (request && response.command === request.command) {
        settleRequest(response.id!, response.ok === true, response.ok === true ? undefined : response.error?.message || "画布操作尚未完成，请检查当前草稿");
        return;
      }
      if (response.command !== "flush" || response.id !== pending?.id) return;
      const saved = response.ok === true && response.result?.saved === true;
      settle(saved, saved ? undefined : response.error?.message || "画布尚未保存，请留在当前项目检查同步状态");
    },
    dispose() {
      if (!active) return;
      active = false;
      ready = false;
      queued = [];
      settle(false);
      for (const id of requests.keys()) settleRequest(id, false);
    },
  };
}
type Props = {
  project: Project;
  userId: string;
  models: Bootstrap["models"];
  assets: Asset[];
  legacyDocument: CanvasDocument;
  onAsset: (asset: Asset) => void;
  onJob: (job: Job) => void;
  onAction: (action: CanvasPlatformAction) => void;
  onRename: (title: string) => void;
  onCatalogChange: () => Promise<void>;
  onModels: (models: Bootstrap["models"]) => void;
  onReady?: () => void;
  onReadinessChange?: (ready: boolean) => void;
};
type RpcRequest = { type: string; id: string; scopeId: string; method: string; params?: Record<string, unknown> };

/** The isolated canvas runs on this origin; account credentials stay in the platform API. */
export const CanvasEngine = forwardRef<CanvasEngineHandle, Props>(function CanvasEngine(props, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef(props);
  current.current = props;
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "frameflow:catalog", scopeId: scope.current, models: props.models }, window.location.origin);
  }, [props.models]);
  const [status, setStatus] = useState("正在加载画布…");
  const [failure, setFailure] = useState("");
  const [reload, setReload] = useState(0);
  const scope = useRef(crypto.randomUUID());
  const commandChannel = useRef<ReturnType<typeof createCanvasCommandChannel> | null>(null);
  const lastTitleSent = useRef<{ scopeId: string; title: string } | null>(null);
  useImperativeHandle(ref, () => ({
    isReady: () => commandChannel.current?.isReady() || false,
    command: (command, payload) => commandChannel.current?.command(command, payload),
    request: (command, payload) => commandChannel.current?.request(command, payload) ?? Promise.resolve(false),
    flush: () => {
      if (commandChannel.current) return commandChannel.current.flush();
      setFailure("画布尚未就绪，请等待加载完成后重试保存");
      return Promise.resolve(false);
    },
  }), []);

  useEffect(() => {
    let active = true;
    let initializing: Promise<void> | undefined;
    const scopeId = scope.current = crypto.randomUUID();
    const projectId = props.project.id;
    const cancellations = new Set<string>();
    const requests = new Set<string>();
    const skillControllers = new Map<string, AbortController>();
    const origin = window.location.origin;
    const send = (data: unknown) => { if (active) frame.current?.contentWindow?.postMessage(data, origin); };
    const channel = createCanvasCommandChannel({ scopeId, send,
      onError: (reason) => { if (active) { setFailure(reason); setStatus("本机编辑尚未确认保存"); } },
      onStatus: (value) => { if (active) { setStatus(value); if (value === "画布已确认保存") setFailure(""); } },
    });
    commandChannel.current = channel;
    current.current.onReadinessChange?.(false);
    const id = (value: unknown) => {
      if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error("素材或任务标识无效");
      return value;
    };
    const updateJob = (job: Job) => {
      if (job.projectId !== projectId) throw new Error("任务不属于当前项目");
      if (active) current.current.onJob(job);
      return job;
    };
    const upload = async (params: Record<string, unknown>) => {
      if (typeof params.dataUrl !== "string" || !/^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm)|audio\/(mpeg|mp3|wav|x-wav|ogg|webm));base64,/i.test(params.dataUrl))
        throw new Error("请上传图片、视频或音频文件");
      const response = await fetch(params.dataUrl);
      const blob = await response.blob();
      const form = new FormData();
      form.append("file", blob, String(params.name || "canvas-asset").slice(0, 200));
      form.append("projectId", projectId);
      const asset = await api<Asset>("/assets", { method: "POST", body: form });
      if (active) current.current.onAsset(asset);
      return asset;
    };
    const execute = async (request: RpcRequest): Promise<unknown> => {
      const params = request.params || {};
      switch (request.method) {
        case "models.refresh": {
          const controller = new AbortController();
          skillControllers.set(request.id, controller);
          const assertCurrent = () => {
            if (!active || cancellations.has(request.id) || controller.signal.aborted ||
                current.current.project.id !== projectId || current.current.userId !== props.userId)
              throw new Error("项目或登录用户已切换，请重新刷新模型状态");
          };
          try {
            assertCurrent();
            const catalog = await api<Bootstrap>("/bootstrap", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
            assertCurrent();
            if (catalog.user?.id !== props.userId) throw new Error("登录用户已切换，请重新打开画布");
            current.current.onModels(catalog.models);
            send({ type: "frameflow:catalog", scopeId, models: catalog.models });
            return catalog.models;
          } finally { skillControllers.delete(request.id); }
        }
        case "channels.list":
        case "channels.save":
        case "channels.delete":
        case "channels.probe":
        case "pool.snapshot":
        case "pool.quota.refresh": {
          const controller = new AbortController();
          skillControllers.set(request.id, controller);
          const assertCurrent = () => {
            if (!active || cancellations.has(request.id) || controller.signal.aborted ||
                current.current.project.id !== projectId || current.current.userId !== props.userId)
              throw new Error("项目或登录用户已切换，请重新打开配置");
          };
          try {
            assertCurrent();
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(request.method === "pool.quota.refresh" ? 90_000 : 20_000)]);
            let result: unknown;
            if (request.method === "pool.snapshot") result = await api("/pool/accounts", { signal });
            else if (request.method === "pool.quota.refresh") result = await api("/pool/quota/refresh", { method: "POST", body: json({}), signal });
            else if (request.method === "channels.list") result = await api("/channels", { signal });
            else if (request.method === "channels.probe") result = await api(`/channels/${id(params.id)}/models`, { method: "POST", signal });
            else if (request.method === "channels.delete") result = await api(`/channels/${id(params.id)}`, { method: "DELETE", signal });
            else result = await api("/channels", { method: "PUT", body: json(params), signal });
            assertCurrent();
            if (["channels.save", "channels.delete", "pool.snapshot", "pool.quota.refresh"].includes(request.method)) await current.current.onCatalogChange();
            assertCurrent();
            return result;
          } finally { skillControllers.delete(request.id); }
        }
        case "skills.list":
        case "skills.detail":
        case "skills.install":
        case "skills.prompt":
        case "skills.prepare": {
          const controller = new AbortController();
          skillControllers.set(request.id, controller);
          const assertCurrent = () => {
            if (!active || cancellations.has(request.id) || controller.signal.aborted ||
                current.current.project.id !== projectId || current.current.userId !== props.userId)
              throw new Error("项目或登录用户已切换，请重新选择技能");
          };
          const context = { api, assertCurrent, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) };
          try {
            if (request.method === "skills.list") return await listCanvasVideoSkills(context);
            if (request.method === "skills.detail") return await readCanvasVideoSkill(context, params);
            if (request.method === "skills.install") return await installCanvasVideoSkill(context, params);
            if (request.method === "skills.prompt") return await prepareCanvasVideoPrompt(context, params);
            return await prepareCanvasVideoSkill(context, params);
          } finally { skillControllers.delete(request.id); }
        }
        case "document.load": return api(`/projects/${projectId}/canvas-engine`);
        case "document.save": {
          if (!params.document || typeof params.document !== "object" || (params.document as {id?:string}).id !== projectId)
            throw new Error("画布与当前项目不一致");
          const saved = await api(`/projects/${projectId}/canvas-engine`, { method: "PUT", body: json({ baseRevision: params.baseRevision, document: params.document }) });
          if (active) { setStatus("已保存到项目"); setFailure(""); }
          return saved;
        }
        case "assets.upload": return upload(params);
        case "assets.list": return api(params.scope === "account" ? "/assets" : `/assets?projectId=${projectId}`);
        case "jobs.create": {
          if (params.projectId !== projectId) throw new Error("生成目标项目已切换");
          const { idempotencyKey, ...body } = params;
          if (typeof idempotencyKey !== "string" || !idempotencyKey) throw new Error("缺少生成请求标识");
          const job = updateJob(await api<Job>("/jobs", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: json(body) }));
          // A cancelled create is never replayed, even if its response was lost.
          if (!active || cancellations.has(request.id)) {
            await api(`/jobs/${id(job.id)}/cancel`, { method: "POST" }).catch(() => undefined);
          }
          return job;
        }
        case "jobs.status": return updateJob(await api<Job>(`/jobs/${id(params.id)}`));
        case "jobs.cancel": {
          const job = await api<Job>(`/jobs/${id(params.id)}`);
          if (job.projectId !== projectId) throw new Error("任务不属于当前项目");
          return updateJob(await api<Job>(`/jobs/${id(params.id)}/cancel`, { method: "POST" }));
        }
        case "platform.action": {
          if (!active || cancellations.has(request.id) || current.current.project.id !== projectId || current.current.userId !== props.userId)
            throw new Error("项目或登录用户已切换，请重新打开入口");
          const action = params.action;
          if (action === "renameProject") {
            const title = typeof params.title === "string" ? params.title.trim().slice(0, 200) : "";
            if (!title) throw new Error("项目名称不能为空");
            if (!active || current.current.project.id !== projectId || current.current.userId !== props.userId) throw new Error("项目已切换，名称未同步");
            if (title !== current.current.project.title.trim()) current.current.onRename(title);
          } else current.current.onAction(parseCanvasPlatformAction(action));
          return { ok: true };
        }
        default: throw new Error("此操作尚未接入平台");
      }
    };
    const initialize = () => initializing ||= (async () => {
      try {
        setFailure("");
        const [snapshot, platformAssets] = await Promise.all([
          api(`/projects/${projectId}/canvas-engine`), api<Asset[]>(`/assets?projectId=${projectId}`),
        ]);
        if (!active) return;
        const title = canvasInitialTitle(snapshot, current.current.project.title);
        lastTitleSent.current = { scopeId, title };
        if (title && current.current.project.title !== title) current.current.onRename(title);
        send({ type: "frameflow:init", scopeId, payload: {
          userId: props.userId, project: { ...current.current.project, title }, baseCanvasDocument: current.current.legacyDocument,
          snapshot, models: current.current.models, assets: platformAssets,
        } });
        setStatus("画布已就绪");
      } catch (cause) { if (active) { channel.dispose(); setFailure(message(cause)); setStatus(""); } }
    })();
    const listener = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== "object") return;
      const request = event.data as RpcRequest;
      if (request.type === "frameflow:ready") { void initialize(); return; }
      if (request.scopeId !== scopeId) return;
      if (request.type === "frameflow:mounted") {
        channel.markMounted();
        current.current.onReadinessChange?.(true);
        current.current.onReady?.();
        return;
      }
      if (request.type === "frameflow:command-response") { channel.receive(request); return; }
      if (request.type === "frameflow:rpc-cancel") {
        if (requests.has(request.id)) cancellations.add(request.id);
        skillControllers.get(request.id)?.abort();
        return;
      }
      if (request.type === "frameflow:status") { setStatus(String((event.data as {message?:string}).message || "")); return; }
      if (request.type !== "frameflow:rpc-request" || typeof request.id !== "string" || requests.has(request.id)) return;
      requests.add(request.id);
      void execute(request).then((result) => {
        if (!cancellations.has(request.id)) send({ type: "frameflow:rpc-response", id: request.id, scopeId, ok: true, result });
      }).catch((cause) => {
        const detail = cause instanceof ApiError ? cause.details : undefined;
        send({ type: "frameflow:rpc-response", id: request.id, scopeId, ok: false,
          error: { message: message(cause), code: detail?.code, ...detail } });
        if (active && request.method === "document.save") { setFailure(message(cause)); setStatus("本机编辑尚未同步"); }
      }).finally(() => { requests.delete(request.id); cancellations.delete(request.id); });
    };
    window.addEventListener("message", listener);
    return () => {
      active = false;
      current.current.onReadinessChange?.(false);
      for (const controller of skillControllers.values()) controller.abort();
      skillControllers.clear();
      channel.dispose();
      if (commandChannel.current === channel) commandChannel.current = null;
      window.removeEventListener("message", listener);
    };
  }, [props.project.id, props.userId, reload]);

  useEffect(() => {
    const title = props.project.title.trim().slice(0, 200);
    if (!title || !commandChannel.current?.isReady() || lastTitleSent.current?.scopeId === scope.current && lastTitleSent.current.title === title) return;
    lastTitleSent.current = { scopeId: scope.current, title };
    commandChannel.current.command("rename", { title });
  }, [props.project.id, props.project.title, props.userId, reload]);

  return <div className="canvas-engine-shell">
    <iframe key={`${props.userId}:${props.project.id}:${reload}`} ref={frame} src="/canvas-engine/index.html" title="映序完整 AI 画布" className="canvas-engine-frame" allow="clipboard-read; clipboard-write; fullscreen" />
    {failure && <div className="canvas-engine-error" role="alert"><span>{failure}</span><button onClick={() => setReload((value) => value + 1)}>重新加载</button></div>}
    <div className="canvas-engine-sync" role="status">{status}</div>
  </div>;
});
