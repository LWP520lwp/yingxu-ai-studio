import { create } from "zustand";
import { configureStorageScope } from "@/lib/localforage-storage";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { validateWorkbenchDocument } from "@/lib/canvas/workbench-document";
import { getPlatformInit, platformRequest, type PlatformInit, type PlatformAsset } from "./rpc";

export type DocumentSnapshot = {
    projectId: string;
    revision: number;
    document: CanvasProject | null;
    updatedAt: string | null;
};
export type DocumentSyncPhase = "loading" | "saved" | "dirty" | "saving" | "error" | "conflict";
export const useDocumentSyncState = create<{
    phase: DocumentSyncPhase; message: string; revision: number; draftAvailable: boolean;
}>(() => ({ phase: "loading", message: "正在读取画布", revision: 0, draftAvailable: false }));

type Draft = { version: 1; userId: string; projectId: string; baseRevision: number; document: CanvasProject; savedAt: string };
type ParentProject = PlatformInit["project"];
export type DocumentSession = {
    projectId: string;
    flush: () => Promise<boolean>;
    retry: () => Promise<boolean>;
    getDraft: () => CanvasProject | null;
    dispose: () => void;
};
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fingerprint = (project: CanvasProject) => JSON.stringify({ ...project, updatedAt: "" });

export function platformAssetToEngineAsset(asset: PlatformAsset, now = new Date().toISOString()): Asset | null {
    const base = {
        id: `platform:${asset.id}`, title: asset.name, coverUrl: "", tags: ["项目素材"], source: "映序项目素材",
        createdAt: now, updatedAt: now, metadata: { platformAssetId: asset.id },
    };
    if (asset.mimeType.startsWith("image/")) return {
        ...base, kind: "image", coverUrl: asset.url,
        data: { dataUrl: asset.url, width: 1024, height: 1024, bytes: asset.size, mimeType: asset.mimeType },
    };
    if (asset.mimeType.startsWith("video/")) return {
        ...base, kind: "video",
        data: { url: asset.url, width: 1280, height: 720, bytes: asset.size, mimeType: asset.mimeType },
    };
    return null;
}

export async function initializePlatformAssets(init: PlatformInit) {
    const { useAssetStore } = await import("@/stores/use-asset-store");
    // Await local hydration first so it cannot later replace the authoritative platform catalog.
    await useAssetStore.persist.rehydrate();
    const localAssets = useAssetStore.getState().assets.filter((asset) => !asset.metadata?.platformAssetId);
    const platformAssets = init.assets.filter((asset) => !asset.projectId || asset.projectId === init.project.id)
        .map((asset) => platformAssetToEngineAsset(asset)).filter((asset): asset is Asset => asset !== null);
    useAssetStore.getState().replaceAssets([...platformAssets, ...localAssets]);
}

/** Reject malformed native data rather than silently replacing it with a blank canvas. */
export function readNativeProject(value: unknown, projectId: string): CanvasProject {
    if (!isRecord(value) || value.id !== projectId || !Array.isArray(value.nodes) || !Array.isArray(value.connections) ||
        value.nodes.length > 1500 || value.connections.length > 6000) throw new Error("已保存的原生画布格式不正确，已停止加载以保护原数据");
    const ids = new Set<string>();
    for (const node of value.nodes) {
        if (!isRecord(node) || typeof node.id !== "string" || !node.id || ids.has(node.id) || typeof node.type !== "string" ||
            !isRecord(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) ||
            !Number.isFinite(node.width) || !Number.isFinite(node.height) || Number(node.width) <= 0 || Number(node.height) <= 0)
            throw new Error("已保存的画布包含无效节点，已保留原数据");
        ids.add(node.id);
    }
    for (const edge of value.connections) {
        if (!isRecord(edge) || typeof edge.id !== "string" || !ids.has(text(edge.fromNodeId)) || !ids.has(text(edge.toNodeId)) || edge.fromNodeId === edge.toNodeId)
            throw new Error("已保存的画布包含无效连接，已保留原数据");
    }
    const domainIssues = validateWorkbenchDocument({
        id: projectId,
        title: text(value.title, "创作画布"),
        revision: 0,
        viewport: { x: finite((value.viewport as Record<string, unknown> | undefined)?.x, 0), y: finite((value.viewport as Record<string, unknown> | undefined)?.y, 0), k: finite((value.viewport as Record<string, unknown> | undefined)?.k, 1) },
        nodes: copy(value.nodes) as CanvasNodeData[],
        connections: copy(value.connections) as CanvasConnection[],
    });
    if (domainIssues.length) throw new Error(`已保存的画布域校验失败：${domainIssues[0].message}`);
    const now = new Date().toISOString();
    const viewport = isRecord(value.viewport) ? value.viewport : {};
    return {
        ...copy(value), id: projectId, title: text(value.title, "创作画布"),
        createdAt: text(value.createdAt, now), updatedAt: text(value.updatedAt, now),
        nodes: copy(value.nodes) as CanvasNodeData[], connections: copy(value.connections) as CanvasConnection[],
        chatSessions: Array.isArray(value.chatSessions) ? copy(value.chatSessions) : [],
        activeChatId: typeof value.activeChatId === "string" ? value.activeChatId : null,
        backgroundMode: ["lines", "dots", "blank"].includes(text(value.backgroundMode)) ? value.backgroundMode as CanvasProject["backgroundMode"] : "lines",
        showImageInfo: value.showImageInfo === true,
        viewport: { x: finite(viewport.x, 0), y: finite(viewport.y, 0), k: Math.max(0.1, Math.min(4, finite(viewport.k, 1))) },
    };
}

/** One-time migration only. Native snapshots always take precedence over the earlier stage format. */
export function migrateLegacyDocument(parent: ParentProject, value: unknown, assets: PlatformAsset[] = []): CanvasProject {
    if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges))
        throw new Error("旧画布数据尚未就绪，已停止空白覆盖");
    const nodes: CanvasNodeData[] = value.nodes.map((source: unknown) => {
        if (!isRecord(source) || typeof source.id !== "string" || !isRecord(source.data) || !isRecord(source.position))
            throw new Error("旧画布节点格式不正确，无法安全迁移");
        const data = source.data;
        if (!["note", "image", "video"].includes(text(data.kind))) throw new Error("旧画布包含未识别节点，无法安全迁移");
        const kind = data.kind === "note" ? CanvasNodeType.Text : data.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
        const hasMedia = Boolean(data.url);
        const width = Math.max(80, Math.min(2400, finite(data.displayWidth, kind === CanvasNodeType.Text ? 260 : hasMedia ? 300 : 360)));
        const ratio = kind === CanvasNodeType.Text ? 0.72 : finite(data.height, kind === CanvasNodeType.Video ? 720 : 1024) / Math.max(1, finite(data.width, kind === CanvasNodeType.Video ? 1280 : 1024));
        const height = Math.max(60, Math.min(2400, finite(data.displayHeight, !hasMedia && kind !== CanvasNodeType.Text ? 260 : Math.max(100, Math.min(900, width * ratio)))));
        return {
            id: source.id, type: kind, title: text(data.title, "未命名素材"),
            position: { x: finite(source.position.x, 0), y: finite(source.position.y, 0) }, width, height,
            metadata: {
                content: kind === CanvasNodeType.Text ? text(data.prompt) : text(data.url),
                prompt: text(data.prompt), composerContent: text(data.prompt),
                status: kind === CanvasNodeType.Text || hasMedia ? "success" : "idle",
                model: text(data.model) || undefined,
                size: `${Math.max(1, finite(data.width, 1024))}x${Math.max(1, finite(data.height, 1024))}`,
                seconds: String(finite(data.duration, 5)),
                naturalWidth: finite(data.width, width), naturalHeight: finite(data.height, height),
                fontSize: kind === CanvasNodeType.Text ? 14 : undefined,
                // Preserve the original platform IDs for generation adapters and future migrations.
                ...{ platformAssetId: data.assetId, platformReferenceAssetIds: data.referenceAssetIds, platformSkillId: data.skillId },
            },
        };
    });
    const ids = new Set(nodes.map((node) => node.id));
    const connections: CanvasConnection[] = [];
    const pairs = new Set<string>();
    const connect = (fromNodeId: string, toNodeId: string, id?: string) => {
        const pair = `${fromNodeId}\u0000${toNodeId}`;
        if (!ids.has(fromNodeId) || !ids.has(toNodeId) || fromNodeId === toNodeId || pairs.has(pair)) return;
        pairs.add(pair);
        connections.push({ id: id || `legacy-${connections.length}-${fromNodeId}`, fromNodeId, toNodeId });
    };
    value.edges.forEach((edge: unknown) => { if (isRecord(edge)) connect(text(edge.source), text(edge.target), text(edge.id)); });
    value.nodes.forEach((node: unknown) => {
        if (isRecord(node) && isRecord(node.data) && Array.isArray(node.data.sourceNodeIds))
            node.data.sourceNodeIds.forEach((source: unknown) => connect(text(source), text(node.id)));
    });
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const referenceNodes = new Map<string, string>();
    value.nodes.forEach((legacy: unknown) => {
        if (!isRecord(legacy) || !isRecord(legacy.data) || !Array.isArray(legacy.data.referenceAssetIds)) return;
        const target = nodes.find((node) => node.id === legacy.id);
        if (!target || target.type === CanvasNodeType.Text) return;
        legacy.data.referenceAssetIds.forEach((reference: unknown, index: number) => {
            if (typeof reference !== "string" || !reference) return;
            const existing = nodes.find((node) => node.id !== target.id && node.type === CanvasNodeType.Image &&
                (node.metadata as Record<string, unknown> | undefined)?.platformAssetId === reference);
            let referenceId = existing?.id || referenceNodes.get(reference);
            if (!referenceId) {
                const asset = assetsById.get(reference);
                referenceId = `legacy-reference-${reference}`;
                let serial = 1;
                while (ids.has(referenceId)) referenceId = `legacy-reference-${reference}-${serial++}`;
                ids.add(referenceId);
                referenceNodes.set(reference, referenceId);
                const available = Boolean(asset && asset.mimeType.startsWith("image/"));
                nodes.push({
                    id: referenceId, type: CanvasNodeType.Image,
                    title: asset?.name || "缺失的旧参考图，请重新上传",
                    position: { x: target.position.x - 396, y: target.position.y + index * 292 }, width: 300, height: 220,
                    metadata: {
                        content: available ? asset!.url : "", status: available ? "success" : "error",
                        errorDetails: available ? undefined : "旧画布的参考素材已不可用，请替换这张参考图后再生成",
                        ...{ platformAssetId: reference },
                    },
                });
            }
            connect(referenceId, target.id);
        });
    });
    const now = new Date().toISOString();
    const viewport = isRecord(value.viewport) ? value.viewport : {};
    return {
        id: parent.id, title: parent.title, createdAt: parent.createdAt || now, updatedAt: parent.updatedAt || now,
        nodes, connections, chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false,
        viewport: { x: finite(viewport.x, 0), y: finite(viewport.y, 0), k: Math.max(0.1, Math.min(4, finite(viewport.zoom, 1))) },
    };
}

function readSnapshot(value: unknown, projectId: string): DocumentSnapshot {
    if (!isRecord(value) || value.projectId !== projectId || !Number.isInteger(value.revision) || Number(value.revision) < 0)
        throw new Error("平台画布版本信息不正确，已停止保存");
    return { projectId, revision: Number(value.revision), document: value.document === null ? null : readNativeProject(value.document, projectId), updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null };
}

function blobDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取画布素材失败，本机草稿已保留"));
        reader.onabort = () => reject(new DOMException("已取消素材保存", "AbortError"));
        reader.readAsDataURL(blob);
    });
}

/** Upload transient editing results; the MySQL snapshot contains portable platform asset URLs only. */
export async function portableProject(
    project: CanvasProject,
    upload: (params: { name: string; mimeType: string; dataUrl: string }) => Promise<PlatformAsset>,
    mediaCache = new Map<string, Promise<string>>(),
    signal?: AbortSignal,
): Promise<CanvasProject> {
    const check = () => { if (signal?.aborted) throw new DOMException("画布已关闭", "AbortError"); };
    const persistentUrl = (url: string): Promise<string> => {
        const known = mediaCache.get(url);
        if (known) return known;
        const task = (async () => {
            check();
            const response = await fetch(url, { signal });
            if (!response.ok) throw new Error("画布中的本机素材已失效，草稿已保留，请重新上传该素材");
            const blob = await response.blob();
            if (!/^(image|video|audio)\//.test(blob.type)) throw new Error("画布素材格式无法保存，请重新上传图片、视频或音频");
            const extension = blob.type.split("/")[1]?.split(/[+;]/)[0] || "bin";
            const dataUrl = await blobDataUrl(blob);
            check();
            const asset = await upload({ name: `画布素材-${crypto.randomUUID().slice(0, 8)}.${extension}`, mimeType: blob.type, dataUrl });
            check();
            if (!/^\/api\/assets\/[a-zA-Z0-9-]+\/content(?:\?|$)/.test(asset.url)) throw new Error("平台未返回可持久保存的素材地址");
            return asset.url;
        })();
        mediaCache.set(url, task);
        void task.catch(() => { if (mediaCache.get(url) === task) mediaCache.delete(url); });
        return task;
    };
    const visit = async (value: unknown): Promise<unknown> => {
        check();
        if (typeof value === "string" && /^(blob:|data:(?:image|video|audio)\/)/.test(value)) return persistentUrl(value);
        if (Array.isArray(value)) {
            const result: unknown[] = [];
            for (const child of value) result.push(await visit(child));
            return result;
        }
        if (isRecord(value)) {
            const result: Record<string, unknown> = {};
            for (const [key, child] of Object.entries(value)) result[key] = await visit(child);
            return result;
        }
        return value;
    };
    return await visit(project) as CanvasProject;
}

export async function initializePlatformDocument(init: PlatformInit): Promise<DocumentSession> {
    configureStorageScope(init.userId, init.project.id);
    const snapshot = readSnapshot(init.snapshot ?? await platformRequest("document.load", {}), init.project.id);
    let revision = snapshot.revision;
    const original = snapshot.document || migrateLegacyDocument(init.project, init.baseCanvasDocument, init.assets);
    const key = `frameflow:canvas-engine:draft:${encodeURIComponent(init.userId)}:${encodeURIComponent(init.project.id)}`;
    let draft: Draft | null = null;
    let retainedDraft: CanvasProject | null = null;
    let staleDraft = false;
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            const candidate = JSON.parse(stored) as Draft;
            if (candidate.version === 1 && candidate.userId === init.userId && candidate.projectId === init.project.id) {
                candidate.document = readNativeProject(candidate.document, init.project.id);
                if (candidate.baseRevision === revision) draft = candidate;
                else {
                    staleDraft = true;
                    retainedDraft = candidate.document;
                    // Preserve the conflicting version separately before later edits reuse the active key.
                    localStorage.setItem(`${key}:retained:${candidate.baseRevision}:${encodeURIComponent(candidate.savedAt || "unknown")}`, stored);
                }
            }
        }
    } catch { staleDraft = true; }
    let project = draft?.document || original;
    if (draft) {
        const { hydrateCanvasImages, hydrateAssistantImages } = await import("@/lib/canvas/canvas-generation-helpers");
        project = { ...project, nodes: await hydrateCanvasImages(project.nodes), chatSessions: await hydrateAssistantImages(project.chatSessions) };
    }
    await initializePlatformAssets(init);
    // Set hydrated only after the full authoritative project has been installed. No bootstrap blank writes.
    useCanvasStore.setState({ projects: [project], deletedProjects: [], hydrated: true });
    const controller = new AbortController();
    let active = true;
    let blocked = false;
    let pending: CanvasProject | null = null;
    let inFlight: CanvasProject | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let saving: Promise<boolean> | null = null;
    let lastSaved = fingerprint(original);
    const mediaCache = new Map<string, Promise<string>>();
    const scoped = () => active && !controller.signal.aborted && (!getPlatformInit() || getPlatformInit()?.scopeId === init.scopeId);
    const status = (phase: DocumentSyncPhase, message: string) => {
        if (scoped()) useDocumentSyncState.setState({ phase, message, revision, draftAvailable: staleDraft || Boolean(pending || inFlight) });
    };
    const preserve = (document: CanvasProject) => {
        try {
            localStorage.setItem(key, JSON.stringify({ version: 1, userId: init.userId, projectId: init.project.id, baseRevision: revision, document, savedAt: new Date().toISOString() } satisfies Draft));
            return true;
        } catch {
            status("error", "浏览器空间不足，草稿暂未落盘，请保持页面打开并重试保存");
            return false;
        }
    };
    const flush = (): Promise<boolean> => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (saving) return saving;
        if (!scoped() || blocked) return Promise.resolve(false);
        const run = async () => {
            while (pending && scoped() && !blocked) {
                const document = pending;
                pending = null;
                const currentFingerprint = fingerprint(document);
                if (currentFingerprint === lastSaved) {
                    if (!staleDraft) localStorage.removeItem(key);
                    status("saved", staleDraft ? "画布已保存；另有版本不同的本机草稿保留" : "画布已保存");
                    continue;
                }
                inFlight = document;
                status("saving", "正在保存画布和素材");
                try {
                    const portable = await portableProject(document, (params) => {
                        if (!scoped()) throw new DOMException("画布项目已切换", "AbortError");
                        return platformRequest<PlatformAsset>("assets.upload", params, { signal: controller.signal });
                    }, mediaCache, controller.signal);
                    if (!scoped()) return false;
                    const result = readSnapshot(await platformRequest("document.save", { baseRevision: revision, document: portable }, { signal: controller.signal }), init.project.id);
                    if (!scoped()) return false;
                    if (result.revision <= revision) throw new Error("平台未确认新的画布版本，请核对后重试");
                    revision = result.revision;
                    lastSaved = currentFingerprint;
                    inFlight = null;
                    if (pending) preserve(pending);
                    else if (!staleDraft) localStorage.removeItem(key);
                    status(pending ? "dirty" : "saved", pending ? "正在保存后续编辑" : staleDraft ? "画布已保存；另有版本不同的本机草稿保留" : "画布已保存");
                } catch (error) {
                    if (!scoped()) return false;
                    pending ||= document;
                    inFlight = null;
                    const draftSaved = preserve(pending);
                    blocked = true;
                    const conflict = isRecord(error) && error.code === "CANVAS_ENGINE_REVISION_CONFLICT";
                    const retained = draftSaved ? "本机草稿已保留" : "页面中保留了未同步编辑，请勿关闭页面";
                    status(conflict ? "conflict" : "error", conflict ? `其他页面已修改此画布，${retained}，请核对版本后再处理` : `${error instanceof Error ? error.message : "画布保存失败"}；${retained}，可重试保存`);
                    return false;
                }
            }
            return scoped() && !blocked;
        };
        saving = run().finally(() => { saving = null; });
        return saving;
    };
    const queue = (document: CanvasProject) => {
        if (!scoped() || document.id !== init.project.id || fingerprint(document) === lastSaved && !pending && !saving) return;
        pending = copy(document);
        const draftSaved = preserve(pending);
        if (blocked) return;
        status("dirty", draftSaved ? "本机草稿已保存，等待同步" : "本机空间不足，正在尝试保存到服务器，请勿关闭页面");
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; void flush(); }, 500);
    };
    const unsubscribe = useCanvasStore.subscribe((state, previous) => {
        if (!scoped() || state.projects === previous.projects) return;
        const current = state.projects.find((item) => item.id === init.project.id);
        if (current) queue(current);
    });
    status("saved", staleDraft ? "服务器画布已加载；检测到版本不同的本机草稿，未自动覆盖" : draft ? "已恢复本机未同步草稿" : "画布已加载");
    if (draft || !snapshot.document && (project.nodes.length > 0 || project.connections.length > 0)) {
        // Save the one-time migration/recovered draft only after authoritative initialization.
        if (!snapshot.document) lastSaved = "";
        queue(project);
    }
    const preserveBeforeExit = () => { if (pending || inFlight) preserve((pending || inFlight)!); };
    window.addEventListener("pagehide", preserveBeforeExit);
    return {
        projectId: init.project.id,
        flush,
        retry: () => { blocked = false; return flush(); },
        getDraft: () => pending || inFlight ? copy((pending || inFlight)!) : retainedDraft ? copy(retainedDraft) : null,
        dispose: () => {
            if (!active) return;
            preserveBeforeExit();
            active = false;
            controller.abort();
            unsubscribe();
            if (timer) clearTimeout(timer);
            window.removeEventListener("pagehide", preserveBeforeExit);
        },
    };
}
