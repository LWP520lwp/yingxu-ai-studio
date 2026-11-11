/**
 * Atlas bridge
 *
 * The canvas is an isolated document so credentials and provider calls remain
 * in the host application. This module is the small, typed boundary between
 * the editor and that host. The wire labels are kept stable for existing
 * deployed shells; the rest of the implementation is owned by Atlas.
 */

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
type WireMessage = { type?: string; id?: string; scopeId?: string; ok?: boolean; payload?: unknown; result?: unknown; models?: unknown; error?: { message?: unknown; code?: unknown } };

// Host labels remain stable for existing shells. Keeping them in one private
// table lets a future bridge version change compatibility in one place.
const WIRE = {
    ready: "frameflow:ready",
    init: "frameflow:init",
    catalog: "frameflow:catalog",
    request: "frameflow:rpc-request",
    response: "frameflow:rpc-response",
    cancel: "frameflow:rpc-cancel",
    status: "frameflow:status",
} as const;

const pending = new Map<string, PendingRequest>();
const initListeners = new Set<(init: PlatformInit) => void>();
let currentInit: PlatformInit | null = null;

function hostOrigin() {
    if (typeof document !== "undefined" && document.referrer) {
        try { return new URL(document.referrer).origin; } catch { /* use current origin */ }
    }
    return typeof window !== "undefined" ? window.location.origin : "";
}
const parentOrigin = hostOrigin();

function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object"; }

function post(message: Record<string, unknown>) {
    if (typeof window === "undefined" || window.parent === window) throw new Error("请从映序工作台打开此画布，生成由平台账号统一处理");
    window.parent.postMessage(message, parentOrigin);
}

function normalizeModels(value: unknown): PlatformModels {
    const source = isObject(value) ? value : {};
    const list = (items: unknown): PlatformModel[] => (Array.isArray(items) ? items : []).flatMap((item): PlatformModel[] => {
        if (typeof item === "string") return [{ id: item, available: false }];
        if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) return [];
        return [{ id: item.id, name: typeof item.name === "string" ? item.name : item.id, available: item.available === true, caps: isObject(item.caps) ? item.caps : undefined }];
    });
    return { image: list(source.image), video: list(source.video) };
}

function abortError() { return new DOMException("操作已取消；已提交的生成请在任务列表核对状态", "AbortError"); }
function notify(init: PlatformInit) { for (const listener of initListeners) listener(init); }

function rejectScope(scopeId: string) {
    for (const [id, request] of pending) {
        if (request.scopeId !== scopeId) continue;
        request.dispose(); request.reject(abortError()); pending.delete(id);
    }
}

function readInit(message: WireMessage): PlatformInit | null {
    if (typeof message.scopeId !== "string" || !message.scopeId || !isObject(message.payload)) return null;
    const payload = message.payload;
    const project = isObject(payload.project) ? payload.project : null;
    if (typeof payload.userId !== "string" || !project || typeof project.id !== "string") return null;
    return { ...payload, scopeId: message.scopeId, project: project as PlatformInit["project"], models: normalizeModels(payload.models), assets: Array.isArray(payload.assets) ? payload.assets as PlatformAsset[] : [] } as PlatformInit;
}

function receive(event: MessageEvent) {
    if (event.source !== window.parent || event.origin !== parentOrigin || !isObject(event.data)) return;
    const message = event.data as WireMessage;
    if (message.type === WIRE.catalog && currentInit && message.scopeId === currentInit.scopeId) {
        currentInit = { ...currentInit, models: normalizeModels(message.models) }; notify(currentInit); return;
    }
    if (message.type === WIRE.init) {
        const next = readInit(message); if (!next) return;
        if (currentInit && currentInit.scopeId !== next.scopeId) rejectScope(currentInit.scopeId);
        currentInit = next; notify(next); return;
    }
    if (message.type !== WIRE.response || typeof message.id !== "string") return;
    const request = pending.get(message.id);
    if (!request || message.scopeId !== request.scopeId || currentInit?.scopeId !== request.scopeId) return;
    pending.delete(message.id); request.dispose();
    if (message.ok === true) { request.resolve(message.result); return; }
    const error = new Error(typeof message.error?.message === "string" ? message.error.message : "平台请求失败，请检查任务状态后再操作");
    Object.assign(error, { code: typeof message.error?.code === "string" ? message.error.code : "PLATFORM_REQUEST_FAILED" }); request.reject(error);
}

if (typeof window !== "undefined") {
    window.addEventListener("message", receive);
    queueMicrotask(() => { if (window.parent !== window) { try { post({ type: WIRE.ready }); } catch { /* standalone mode waits for a host */ } } });
}

export function platformAbortError() { return abortError(); }
export function getPlatformInit() { return currentInit; }
export function notifyPlatformStatus(message: string) { if (currentInit) post({ type: WIRE.status, scopeId: currentInit.scopeId, message }); }

export function onPlatformInit(listener: (init: PlatformInit) => void) {
    initListeners.add(listener); if (currentInit) listener(currentInit); return () => { initListeners.delete(listener); };
}

export function waitForPlatformInit(options?: PlatformRequestOptions): Promise<PlatformInit> {
    if (options?.signal?.aborted) return Promise.reject(abortError());
    if (currentInit) return Promise.resolve(currentInit);
    return new Promise((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout>;
        let interval: ReturnType<typeof setInterval>;
        const dispose = () => { clearTimeout(timeout); clearInterval(interval); initListeners.delete(ready); options?.signal?.removeEventListener("abort", aborted); };
        const ready = (init: PlatformInit) => { dispose(); resolve(init); };
        const aborted = () => { dispose(); reject(abortError()); };
        timeout = setTimeout(() => { dispose(); reject(new Error("平台画布初始化超时，请回到工作台重新打开项目")); }, options?.timeoutMs ?? 20_000);
        const announce = () => { try { post({ type: WIRE.ready }); } catch { /* timeout gives standalone error */ } };
        interval = setInterval(announce, 1000); initListeners.add(ready); options?.signal?.addEventListener("abort", aborted, { once: true }); announce();
    });
}

export async function platformRequest<T = unknown>(method: string, params: unknown = {}, options?: PlatformRequestOptions): Promise<T> {
    const init = await waitForPlatformInit(options);
    if (options?.signal?.aborted || currentInit?.scopeId !== init.scopeId) throw abortError();
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout>;
        const dispose = () => { clearTimeout(timeout); options?.signal?.removeEventListener("abort", aborted); };
        const cancel = () => { pending.delete(id); dispose(); try { post({ type: WIRE.cancel, id, scopeId: init.scopeId }); } catch { /* host may already be gone */ } reject(abortError()); };
        const expired = () => { pending.delete(id); dispose(); try { post({ type: WIRE.cancel, id, scopeId: init.scopeId }); } catch { /* host may already be gone */ } reject(new Error("平台请求超时，生成提交状态可能未确认；请核对任务列表，系统不会自动重复提交")); };
        const aborted = cancel;
        timeout = setTimeout(expired, options?.timeoutMs ?? 120_000);
        pending.set(id, { scopeId: init.scopeId, resolve: (value) => resolve(value as T), reject, dispose });
        options?.signal?.addEventListener("abort", aborted, { once: true });
        try { post({ type: WIRE.request, id, scopeId: init.scopeId, method, params }); }
        catch (error) { pending.delete(id); dispose(); reject(error instanceof Error ? error : new Error(String(error))); }
    });
}

export async function refreshPlatformModels(options?: PlatformRequestOptions): Promise<PlatformModels> {
    const init = await waitForPlatformInit(options);
    const result = await platformRequest<unknown>("models.refresh", {}, { ...options, timeoutMs: options?.timeoutMs ?? 25_000 });
    if (options?.signal?.aborted || currentInit?.scopeId !== init.scopeId) throw abortError();
    if (!isObject(result) || !Array.isArray(result.image) || !Array.isArray(result.video)) throw new Error("模型状态刷新未返回有效目录，请稍后重试");
    if (currentInit !== init) return currentInit?.models ?? normalizeModels(result);
    currentInit = { ...init, models: normalizeModels(result) }; notify(currentInit); return currentInit.models;
}
