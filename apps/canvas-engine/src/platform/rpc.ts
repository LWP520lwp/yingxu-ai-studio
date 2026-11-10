export type PlatformModel = { id: string; name?: string; available: boolean; caps?: Record<string, unknown> };
export type PlatformModels = { image: PlatformModel[]; video: PlatformModel[] };
export type PlatformAsset = { id: string; url: string; name: string; mimeType: string; size: number; projectId?: string | null };
export type PlatformInit = {
    scopeId: string;
    userId: string;
    project: { id: string; title: string; createdAt?: string; updatedAt?: string; revision?: number };
    baseCanvasDocument: Record<string, unknown>;
    snapshot: unknown;
    models: PlatformModels;
    assets: PlatformAsset[];
};
export type PlatformRequestOptions = { signal?: AbortSignal; timeoutMs?: number };

type PendingRequest = { scopeId: string; resolve: (value: unknown) => void; reject: (error: Error) => void; dispose: () => void };
const requests = new Map<string, PendingRequest>();
const initListeners = new Set<(init: PlatformInit) => void>();
let initialization: PlatformInit | null = null;
const parentOrigin = typeof document !== "undefined" && document.referrer ? new URL(document.referrer).origin : typeof window !== "undefined" ? window.location.origin : "";

export function platformAbortError() {
    return new DOMException("操作已取消；已提交的生成请在任务列表核对状态", "AbortError");
}

function send(message: Record<string, unknown>) {
    if (typeof window === "undefined" || window.parent === window) throw new Error("请从映序工作台打开此画布，生成由平台账号统一处理");
    window.parent.postMessage(message, parentOrigin);
}

function normalizeModels(value: unknown): PlatformModels {
    const models = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const list = (items: unknown) => (Array.isArray(items) ? items : []).flatMap((item): PlatformModel[] => {
        if (typeof item === "string") return [{ id: item, available: false }];
        if (!item || typeof item !== "object" || typeof item.id !== "string") return [];
        return [{ id: item.id, name: typeof item.name === "string" ? item.name : item.id, available: item.available === true, caps: item.caps && typeof item.caps === "object" ? item.caps : undefined }];
    });
    return { image: list(models.image), video: list(models.video) };
}

if (typeof window !== "undefined") {
    window.addEventListener("message", (event: MessageEvent) => {
        if (event.source !== window.parent || event.origin !== parentOrigin || !event.data || typeof event.data !== "object") return;
        const message = event.data;
        if (message.type === "frameflow:catalog" && initialization && message.scopeId === initialization.scopeId) {
            initialization = { ...initialization, models: normalizeModels(message.models) };
            for (const listener of initListeners) listener(initialization);
            return;
        }
        if (message.type === "frameflow:init") {
            const payload = message.payload;
            if (typeof message.scopeId !== "string" || !message.scopeId || !payload || typeof payload.userId !== "string" || typeof payload.project?.id !== "string") return;
            if (initialization && initialization.scopeId !== message.scopeId) {
                for (const pending of requests.values()) { pending.dispose(); pending.reject(platformAbortError()); }
                requests.clear();
            }
            initialization = { ...payload, scopeId: message.scopeId, models: normalizeModels(payload.models), assets: Array.isArray(payload.assets) ? payload.assets : [] } as PlatformInit;
            for (const listener of initListeners) listener(initialization);
            return;
        }
        if (message.type !== "frameflow:rpc-response" || typeof message.id !== "string") return;
        const pending = requests.get(message.id);
        if (!pending || message.scopeId !== pending.scopeId || initialization?.scopeId !== pending.scopeId) return;
        requests.delete(message.id);
        pending.dispose();
        if (message.ok === true) pending.resolve(message.result);
        else {
            const error = new Error(typeof message.error?.message === "string" ? message.error.message : "平台请求失败，请检查任务状态后再操作");
            Object.assign(error, { code: typeof message.error?.code === "string" ? message.error.code : "PLATFORM_REQUEST_FAILED" });
            pending.reject(error);
        }
    });
    queueMicrotask(() => { if (window.parent !== window) send({ type: "frameflow:ready" }); });
}

export function getPlatformInit() { return initialization; }

export function notifyPlatformStatus(message: string) {
    if (initialization) send({ type: "frameflow:status", scopeId: initialization.scopeId, message });
}

export function onPlatformInit(listener: (init: PlatformInit) => void) {
    initListeners.add(listener);
    if (initialization) listener(initialization);
    return () => { initListeners.delete(listener); };
}

export function waitForPlatformInit(options?: PlatformRequestOptions): Promise<PlatformInit> {
    if (options?.signal?.aborted) return Promise.reject(platformAbortError());
    if (initialization) return Promise.resolve(initialization);
    return new Promise((resolve, reject) => {
        const dispose = () => { clearTimeout(timeout); clearInterval(ready); initListeners.delete(initialized); options?.signal?.removeEventListener("abort", aborted); };
        const initialized = (init: PlatformInit) => { dispose(); resolve(init); };
        const aborted = () => { dispose(); reject(platformAbortError()); };
        const timeout = setTimeout(() => { dispose(); reject(new Error("平台画布初始化超时，请回到工作台重新打开项目")); }, options?.timeoutMs ?? 20_000);
        const announce = () => { try { send({ type: "frameflow:ready" }); } catch { /* The initialization timeout reports standalone use. */ } };
        const ready = setInterval(announce, 1000);
        initListeners.add(initialized);
        options?.signal?.addEventListener("abort", aborted, { once: true });
        announce();
    });
}

export async function platformRequest<T = unknown>(method: string, params: unknown = {}, options?: PlatformRequestOptions): Promise<T> {
    const init = await waitForPlatformInit(options);
    if (options?.signal?.aborted || initialization?.scopeId !== init.scopeId) throw platformAbortError();
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
        const dispose = () => { clearTimeout(timeout); options?.signal?.removeEventListener("abort", aborted); };
        const aborted = () => {
            requests.delete(id); dispose();
            send({ type: "frameflow:rpc-cancel", id, scopeId: init.scopeId });
            reject(platformAbortError());
        };
        const timeout = setTimeout(() => {
            requests.delete(id); dispose();
            send({ type: "frameflow:rpc-cancel", id, scopeId: init.scopeId });
            reject(new Error("平台请求超时，生成提交状态可能未确认；请核对任务列表，系统不会自动重复提交"));
        }, options?.timeoutMs ?? 120_000);
        requests.set(id, { scopeId: init.scopeId, resolve: (value) => resolve(value as T), reject, dispose });
        options?.signal?.addEventListener("abort", aborted, { once: true });
        try { send({ type: "frameflow:rpc-request", id, scopeId: init.scopeId, method, params }); }
        catch (error) { requests.delete(id); dispose(); reject(error); }
    });
}

/** Refresh only the server's model availability; keep this canvas and its draft mounted. */
export async function refreshPlatformModels(options?: PlatformRequestOptions): Promise<PlatformModels> {
    const init = await waitForPlatformInit(options);
    const result = await platformRequest<unknown>("models.refresh", {}, { ...options, timeoutMs: options?.timeoutMs ?? 25_000 });
    if (options?.signal?.aborted || initialization?.scopeId !== init.scopeId) throw platformAbortError();
    if (!result || typeof result !== "object" || !Array.isArray((result as PlatformModels).image) || !Array.isArray((result as PlatformModels).video))
        throw new Error("模型状态刷新未返回有效目录，请稍后重试");
    // The host may already have pushed a newer scoped catalog while this RPC
    // was pending. Its live update takes precedence over this response.
    if (initialization !== init) return initialization.models;
    initialization = { ...initialization, models: normalizeModels(result) };
    for (const listener of initListeners) listener(initialization);
    return initialization.models;
}
