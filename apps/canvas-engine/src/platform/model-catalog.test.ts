import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformInit } from "./rpc";

const origin = "http://localhost:5178";
let receive: (event: MessageEvent) => void;
let host: { postMessage: ReturnType<typeof vi.fn> };
let rpc: typeof import("./rpc");
const unavailable = () => ({ image: [{ id: "muse-service-image", available: false }], video: [{ id: "muse-service-video", available: false }] });
const available = () => ({ image: [{ id: "muse-service-image", available: true }], video: [{ id: "muse-service-video", available: true }] });
const dispatch = (data: unknown, eventOrigin = origin) => receive({ source: host, origin: eventOrigin, data } as unknown as MessageEvent);
const context = (scopeId = "scope"): PlatformInit => ({ scopeId, userId: "user", project: { id: "project", title: "未保存标题" }, baseCanvasDocument: {},
    snapshot: { document: { nodes: [{ id: "saved-node", metadata: { model: "platform::muse-video", content: "尚未保存的镜头文字" } }], viewport: { x: 16, y: 29, k: 0.8 } } }, models: unavailable(), assets: [] });
const request = async () => {
    await vi.waitFor(() => expect(host.postMessage.mock.calls.some(([data]) => data.type === "frameflow:rpc-request")).toBe(true));
    return host.postMessage.mock.calls.find(([data]) => data.type === "frameflow:rpc-request")![0];
};
const reply = (id: string, result: unknown, scopeId = "scope") => dispatch({ type: "frameflow:rpc-response", id, scopeId, ok: true, result });

beforeEach(async () => {
    vi.resetModules();
    host = { postMessage: vi.fn() };
    vi.stubGlobal("document", { referrer: `${origin}/` });
    vi.stubGlobal("window", { parent: host, location: { origin }, addEventListener: (type: string, listener: (event: MessageEvent) => void) => { if (type === "message") receive = listener; } });
    rpc = await import("./rpc");
    const init = context(); dispatch({ type: "frameflow:init", scopeId: init.scopeId, payload: init });
    host.postMessage.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("refreshing model availability without remounting the draft", () => {
    it("loads real readiness through a read-only RPC and preserves the full editor snapshot", async () => {
        const before = rpc.getPlatformInit()!;
        const listener = vi.fn(); const stop = rpc.onPlatformInit(listener); listener.mockClear();
        const pending = rpc.refreshPlatformModels();
        const sent = await request();
        expect(sent).toMatchObject({ method: "models.refresh", scopeId: "scope", params: {} });
        expect(host.postMessage.mock.calls.every(([data]) => data.type !== "frameflow:ready")).toBe(true);
        reply(sent.id, available());
        await expect(pending).resolves.toEqual({ image: [{ id: "muse-service-image", name: "muse-service-image", available: true, caps: undefined }], video: [{ id: "muse-service-video", name: "muse-service-video", available: true, caps: undefined }] });
        expect(rpc.getPlatformInit()!.snapshot).toBe(before.snapshot);
        expect(rpc.getPlatformInit()!.project).toBe(before.project);
        expect(rpc.getPlatformInit()!.assets).toBe(before.assets);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(rpc.getPlatformInit()!.snapshot)).toContain("platform::muse-video");
        stop();
    });

    it("keeps genuine unavailability instead of assuming an ended task made a provider ready", async () => {
        const pending = rpc.refreshPlatformModels(); const sent = await request(); reply(sent.id, unavailable());
        expect((await pending).video[0].available).toBe(false);
    });

    it("keeps distinct image and video capabilities from the refreshed catalog", async () => {
        const pending = rpc.refreshPlatformModels();
        const sent = await request();
        reply(sent.id, { image: [{ id: "image-only", available: true }], video: [{ id: "video-only", available: false }] });
        await expect(pending).resolves.toMatchObject({
            image: [{ id: "image-only", available: true }],
            video: [{ id: "video-only", available: false }],
        });
    });

    it("does not replace a newer catalog pushed by the host while waiting", async () => {
        const listener = vi.fn(); const stop = rpc.onPlatformInit(listener); listener.mockClear();
        const pending = rpc.refreshPlatformModels(); const sent = await request();
        dispatch({ type: "frameflow:catalog", scopeId: "scope", models: available() });
        reply(sent.id, unavailable());
        expect((await pending).video[0].available).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        stop();
    });

    it("reports refresh failure without clearing the existing catalog or snapshot", async () => {
        const before = rpc.getPlatformInit();
        const pending = rpc.refreshPlatformModels(); const sent = await request();
        dispatch({ type: "frameflow:rpc-response", id: sent.id, scopeId: "scope", ok: false, error: { message: "模型目录读取失败" } });
        await expect(pending).rejects.toThrow("模型目录读取失败");
        expect(rpc.getPlatformInit()).toBe(before);
    });

    it("rejects malformed refresh results without changing existing availability", async () => {
        const before = rpc.getPlatformInit();
        const pending = rpc.refreshPlatformModels(); const sent = await request(); reply(sent.id, { video: [] });
        await expect(pending).rejects.toThrow("有效目录");
        expect(rpc.getPlatformInit()).toBe(before);
    });

    it("discards refresh responses after changing the project scope", async () => {
        const pending = rpc.refreshPlatformModels(); const sent = await request();
        const next = context("other-scope"); dispatch({ type: "frameflow:init", scopeId: next.scopeId, payload: next });
        reply(sent.id, available());
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(rpc.getPlatformInit()!.scopeId).toBe("other-scope");
        expect(rpc.getPlatformInit()!.models.video[0].available).toBe(false);
    });

    it("honors cancellation and ignores an origin that is not the host", async () => {
        const controller = new AbortController(); const before = rpc.getPlatformInit();
        const pending = rpc.refreshPlatformModels({ signal: controller.signal }); const sent = await request();
        dispatch({ type: "frameflow:rpc-response", id: sent.id, scopeId: "scope", ok: true, result: available() }, "https://other.invalid");
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(rpc.getPlatformInit()).toBe(before);
        expect(host.postMessage.mock.calls.some(([data]) => data.type === "frameflow:rpc-cancel")).toBe(true);
    });
});
