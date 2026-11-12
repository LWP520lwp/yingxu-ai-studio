import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { PlatformInit } from "./rpc";

const harness = vi.hoisted(() => {
    type State = { projects: CanvasProject[]; deletedProjects: unknown[]; hydrated: boolean };
    let state: State = { projects: [], deletedProjects: [], hydrated: false };
    const listeners = new Set<(current: State, previous: State) => void>();
    return {
        request: vi.fn(), configure: vi.fn(), replaceAssets: vi.fn(),
        store: {
            getState: () => state,
            setState: (patch: Partial<State>) => {
                const previous = state;
                state = { ...state, ...patch };
                listeners.forEach((listener) => listener(state, previous));
            },
            subscribe: (listener: (current: State, previous: State) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        reset: () => { listeners.clear(); state = { projects: [], deletedProjects: [], hydrated: false }; },
    };
});
vi.mock("@/lib/localforage-storage", () => ({ configureStorageScope: harness.configure }));
vi.mock("@/stores/canvas/use-canvas-store", () => ({ useCanvasStore: harness.store }));
vi.mock("@/stores/use-asset-store", () => ({ useAssetStore: {
    persist: { rehydrate: async () => undefined }, getState: () => ({ assets: [], replaceAssets: harness.replaceAssets }),
} }));
vi.mock("./rpc", () => ({ getPlatformInit: () => null, platformRequest: harness.request }));
vi.mock("@/lib/canvas/canvas-generation-helpers", () => ({
    hydrateCanvasImages: async (nodes: unknown) => nodes,
    hydrateAssistantImages: async (sessions: unknown) => sessions,
}));

import { initializePlatformDocument, migrateLegacyDocument, portableProject, readNativeProject, useDocumentSyncState, type DocumentSession } from "./document";

const project = (title = "原生画布"): CanvasProject => ({
    id: "project-one", title, createdAt: "2026-11-10", updatedAt: "2026-11-10",
    nodes: [{ id: "text-one", type: "text", title: "文字", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "原有内容" } }],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
});
const init = (document: CanvasProject | null = project(), revision = 3): PlatformInit => ({
    scopeId: "scope-one", userId: "user-one", project: { id: "project-one", title: "项目一" },
    baseCanvasDocument: { schemaVersion: 1, nodes: [], edges: [] },
    snapshot: { projectId: "project-one", revision, document, updatedAt: null }, models: { image: [], video: [] }, assets: [],
});
let sessions: DocumentSession[] = [];
let local: Map<string, string>;
const open = async (context = init()) => { const session = await initializePlatformDocument(context); sessions.push(session); return session; };
const edit = (title: string) => harness.store.setState({ projects: [{ ...harness.store.getState().projects[0], title }] });

beforeEach(() => {
    harness.reset(); harness.request.mockReset(); harness.configure.mockReset(); harness.replaceAssets.mockReset();
    sessions = []; local = new Map();
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => local.get(key) || null,
        setItem: (key: string, value: string) => local.set(key, value),
        removeItem: (key: string) => local.delete(key),
    });
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    let revision = 3;
    harness.request.mockImplementation(async (method: string, params: { document: CanvasProject }) => {
        if (method !== "document.save") throw new Error(`Unexpected RPC ${method}`);
        return { projectId: "project-one", revision: ++revision, document: params.document, updatedAt: "2026-11-10" };
    });
});
afterEach(() => { sessions.forEach((session) => session.dispose()); vi.unstubAllGlobals(); });

describe("platform document initialization", () => {
    it("migrates text, display sizes, port connections and legacy references once", () => {
        const migrated = migrateLegacyDocument(init().project, {
            nodes: [
                { id: "note", position: { x: 4, y: 8 }, data: { kind: "note", title: "灵感", prompt: "森林" } },
                { id: "image", position: { x: 400, y: 8 }, data: { kind: "image", title: "照片", prompt: "写实", url: "/api/assets/image-one/content", displayWidth: 500, displayHeight: 300, sourceNodeIds: ["note"] } },
            ],
            edges: [{ id: "edge", source: "note", target: "image" }], viewport: { x: 14, y: 16, zoom: 0.8 },
        });
        expect(migrated.nodes[0]).toMatchObject({ type: "text", metadata: { content: "森林" }, position: { x: 4, y: 8 } });
        expect(migrated.nodes[1]).toMatchObject({ width: 500, height: 300, metadata: { content: "/api/assets/image-one/content", prompt: "写实" } });
        expect(migrated.connections).toEqual([{ id: "edge", fromNodeId: "note", toNodeId: "image" }]);
        expect(migrated.viewport).toEqual({ x: 14, y: 16, k: 0.8 });
    });

    it("loads native snapshot before mounting and never saves a bootstrap empty project", async () => {
        const context = init();
        context.baseCanvasDocument = { nodes: [], edges: [] };
        const session = await open(context);
        expect(harness.configure).toHaveBeenCalledWith("user-one", "project-one");
        expect(harness.store.getState()).toMatchObject({ hydrated: true, projects: [{ nodes: [{ id: "text-one" }] }] });
        expect(await session.flush()).toBe(true);
        expect(harness.request).not.toHaveBeenCalled();
    });

    it("seeds existing MySQL image/video assets into the original resource panel", async () => {
        const context = init();
        context.assets = [
            { id: "photo", name: "已有图片", url: "/api/assets/photo/content", mimeType: "image/png", size: 500, projectId: "project-one" },
            { id: "video", name: "已有视频", url: "/api/assets/video/content", mimeType: "video/mp4", size: 1000, projectId: "project-one" },
            { id: "other", name: "其他项目", url: "/api/assets/other/content", mimeType: "image/png", size: 500, projectId: "project-two" },
        ];
        await open(context);
        expect(harness.replaceAssets).toHaveBeenCalledOnce();
        expect(harness.replaceAssets.mock.calls[0][0]).toMatchObject([
            { id: "platform:photo", kind: "image", data: { dataUrl: "/api/assets/photo/content" } },
            { id: "platform:video", kind: "video", data: { url: "/api/assets/video/content" } },
        ]);
    });

    it("turns implicit legacy asset references into reusable visible image connections", () => {
        const migrated = migrateLegacyDocument(init().project, {
            nodes: [
                { id: "image", position: { x: 500, y: 8 }, data: { kind: "image", title: "生图", prompt: "森林", referenceAssetIds: ["asset-one"] } },
                { id: "video", position: { x: 1000, y: 8 }, data: { kind: "video", title: "视频", prompt: "镜头运动", referenceAssetIds: ["asset-one"] } },
            ], edges: [],
        }, [{ id: "asset-one", url: "/api/assets/asset-one/content", name: "参考图", mimeType: "image/png", size: 100 }]);
        expect(migrated.nodes).toHaveLength(3);
        expect(migrated.nodes[2]).toMatchObject({ type: "image", metadata: { content: "/api/assets/asset-one/content" } });
        expect(migrated.connections.map((edge) => [edge.fromNodeId, edge.toNodeId])).toEqual([
            [migrated.nodes[2].id, "image"], [migrated.nodes[2].id, "video"],
        ]);
    });

    it("rejects corrupt native content instead of falling back to legacy or blank", async () => {
        expect(() => readNativeProject({ ...project(), nodes: [{ id: "broken" }] }, "project-one")).toThrow("无效节点");
        expect(() => readNativeProject({ ...project(), connections: [{ id: "lost-edge", fromNodeId: "missing", toNodeId: "text-one" }] }, "project-one")).toThrow("无效连接");
        const context = init();
        context.snapshot = { projectId: "project-one", revision: 3, document: { id: "other" } };
        await expect(open(context)).rejects.toThrow();
        expect(harness.store.getState().hydrated).toBe(false);
        expect(harness.request).not.toHaveBeenCalled();
    });

    it("keeps stale local drafts and other users' drafts from replacing server data", async () => {
        const key = "frameflow:canvas-engine:draft:user-one:project-one";
        local.set(key, JSON.stringify({ version: 1, userId: "user-one", projectId: "project-one", baseRevision: 1, savedAt: "earlier", document: project("旧草稿") }));
        local.set("frameflow:canvas-engine:draft:user-two:project-one", JSON.stringify({ version: 1, userId: "user-two", projectId: "project-one", baseRevision: 3, document: project("其他用户") }));
        const session = await open();
        expect(harness.store.getState().projects[0].title).toBe("原生画布");
        expect(session.getDraft()?.title).toBe("旧草稿");
        expect(local.has(`${key}:retained:1:earlier`)).toBe(true);
        expect(useDocumentSyncState.getState().draftAvailable).toBe(true);
        expect(harness.request).not.toHaveBeenCalled();
    });
});

describe("serialized revision saves", () => {
    it("serializes edits during a pending save and uses the acknowledged revision", async () => {
        const session = await open();
        let first: (value: unknown) => void = () => undefined;
        harness.request.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }));
        edit("第一次编辑");
        const saving = session.flush();
        await vi.waitFor(() => expect(harness.request).toHaveBeenCalledTimes(1));
        edit("保存期间的第二次编辑");
        expect(harness.request).toHaveBeenCalledTimes(1);
        const submitted = harness.request.mock.calls[0][1] as { document: CanvasProject };
        first({ projectId: "project-one", revision: 4, document: submitted.document, updatedAt: null });
        harness.request.mockImplementationOnce(async (_method, params) => ({ projectId: "project-one", revision: 5, document: params.document, updatedAt: null }));
        expect(await saving).toBe(true);
        expect(harness.request.mock.calls.map((call) => call[1].baseRevision)).toEqual([3, 4]);
        expect(harness.request.mock.calls[1][1].document.title).toBe("保存期间的第二次编辑");
        expect(useDocumentSyncState.getState()).toMatchObject({ phase: "saved", revision: 5 });
        expect(local.has("frameflow:canvas-engine:draft:user-one:project-one")).toBe(false);
    });

    it("acknowledges a repeated capture while the identical content is saving", async () => {
        const session = await open();
        let complete: (value: unknown) => void = () => undefined;
        harness.request.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        edit("同一份编辑");
        const saving = session.flush();
        await vi.waitFor(() => expect(harness.request).toHaveBeenCalledTimes(1));
        edit("同一份编辑");
        complete({ projectId: "project-one", revision: 4, document: project("同一份编辑"), updatedAt: null });
        expect(await saving).toBe(true);
        expect(harness.request).toHaveBeenCalledTimes(1);
        expect(useDocumentSyncState.getState()).toMatchObject({ phase: "saved", revision: 4 });
        expect(local.has("frameflow:canvas-engine:draft:user-one:project-one")).toBe(false);
    });

    it("retains local content and reports conflicts without automatic retries", async () => {
        const session = await open();
        harness.request.mockRejectedValueOnce(Object.assign(new Error("冲突"), { code: "CANVAS_ENGINE_REVISION_CONFLICT" }));
        edit("未同步内容");
        expect(await session.flush()).toBe(false);
        expect(useDocumentSyncState.getState().phase).toBe("conflict");
        expect(session.getDraft()?.title).toBe("未同步内容");
        expect(local.get("frameflow:canvas-engine:draft:user-one:project-one")).toContain("未同步内容");
        await session.flush();
        expect(harness.request).toHaveBeenCalledTimes(1);
    });

    it("saves a user revert made while the previous edit is still being submitted", async () => {
        const session = await open();
        let first: (value: unknown) => void = () => undefined;
        harness.request.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }));
        edit("临时修改");
        const saving = session.flush();
        await vi.waitFor(() => expect(harness.request).toHaveBeenCalledTimes(1));
        edit("原生画布");
        first({ projectId: "project-one", revision: 4, document: project("临时修改"), updatedAt: null });
        harness.request.mockImplementationOnce(async (_method, params) => ({ projectId: "project-one", revision: 5, document: params.document, updatedAt: null }));
        expect(await saving).toBe(true);
        expect(harness.request).toHaveBeenCalledTimes(2);
        expect(harness.request.mock.calls[1][1]).toMatchObject({ baseRevision: 4, document: { title: "原生画布" } });
    });

    it("stops queued writes on project unload and preserves the draft", async () => {
        const session = await open();
        edit("关闭前内容");
        session.dispose();
        expect(await session.flush()).toBe(false);
        expect(harness.request).not.toHaveBeenCalled();
        expect(local.get("frameflow:canvas-engine:draft:user-one:project-one")).toContain("关闭前内容");
    });
});

it("uploads transient media once and saves portable URLs without mutating the live document", async () => {
    vi.stubGlobal("FileReader", class {
        result: string | null = null;
        onload?: () => void;
        readAsDataURL(blob: Blob) {
            void blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`; this.onload?.(); });
        }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["image-bytes"], { type: "image/png" }))));
    const live = project();
    live.nodes[0].type = "image";
    live.nodes[0].metadata = { content: "blob:local-test", images: [{ id: "candidate", status: "success", content: "blob:local-test", naturalWidth: 100, naturalHeight: 100, bytes: 20, mimeType: "image/png" }] };
    const upload = vi.fn(async () => ({ id: "asset-one", url: "/api/assets/asset-one/content", name: "图片", mimeType: "image/png", size: 20 }));
    const portable = await portableProject(live, upload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(portable.nodes[0].metadata?.content).toBe("/api/assets/asset-one/content");
    expect(portable.nodes[0].metadata?.images?.[0].content).toBe("/api/assets/asset-one/content");
    expect(JSON.stringify(portable)).not.toContain("blob:");
    expect(JSON.stringify(portable)).not.toContain("data:image/");
    expect(live.nodes[0].metadata?.content).toBe("blob:local-test");
});
