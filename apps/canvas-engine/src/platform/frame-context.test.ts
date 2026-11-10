import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformInit } from "./rpc";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const harness = vi.hoisted(() => ({ init: null as PlatformInit | null, request: vi.fn(), convert: vi.fn() }));
vi.mock("./rpc", () => ({
    getPlatformInit: () => harness.init, waitForPlatformInit: async () => harness.init,
    platformRequest: harness.request, platformAbortError: () => new DOMException("操作已取消", "AbortError"), onPlatformInit: () => () => undefined,
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string, params?: { index?: number }) => key === "imageReferences.label" ? `参考图 ${params?.index}` : key } }));
vi.mock("@/lib/localforage-storage", () => ({ localForageStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: harness.convert }));

import { buildNodeGenerationContext, frameReferenceIssue } from "@/components/canvas/canvas-node-generation";
import { createPlatformGeneration } from "./generation";
import { defaultConfig } from "@/stores/use-config-store";

const node = (id: string, type: CanvasNodeData["type"], metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata });
const image = (id: string, groupId?: string) => node(id, CanvasNodeType.Image, { content: `/api/assets/${id}/content`, mimeType: "image/png", groupId });
const target = () => node("config", CanvasNodeType.Config, { generationMode: "video", videoMode: "frames", composerContent: "镜头平稳过渡" });
const edge = (fromNodeId: string, toNodeId = "config"): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });
const config = () => ({ ...defaultConfig, model: "platform::muse-service-video", videoModel: "platform::muse-service-video", videoMode: "frames", size: "16:9" });

beforeEach(() => {
    harness.init = { scopeId: "scope", userId: "user", project: { id: "project", title: "首尾帧" }, baseCanvasDocument: {}, snapshot: null,
        models: { image: [], video: [{ id: "muse-service-video", available: true, caps: { supportsReferenceImages: true, maxReferenceImages: 4, supportedVideoModes: ["auto", "reference", "frames"] } }] },
        assets: ["a", "b", "c", "other"].map((id) => ({ id, name: id, url: `/api/assets/${id}/content`, mimeType: "image/png", size: 10 })) };
    harness.request.mockReset(); harness.convert.mockReset();
    harness.request.mockImplementation(async (method: string) => { if (method === "jobs.create") return { id: "job", projectId: "project", kind: "video", status: "queued" }; throw new Error(`Unexpected RPC: ${method}`); });
});

describe("first and last frames resolved from actual canvas inputs", () => {
    it("uses incoming connection order with plain text, matching the real submitted asset order", async () => {
        const nodes = [image("b"), target(), image("a")];
        const context = buildNodeGenerationContext("config", nodes, [edge("a"), edge("b")], "镜头平稳过渡");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["a", "b"]);
        expect(context.imageCount).toBe(2); expect(frameReferenceIssue(context.imageCount)).toBeUndefined();
        await createPlatformGeneration(config(), "video", context.prompt, context.referenceImages);
        expect(harness.request.mock.calls[0][1]).toMatchObject({ videoMode: "frames", referenceAssetIds: ["a", "b"] });
        expect(harness.convert).not.toHaveBeenCalled();
    });

    it("allows a single connected first frame", async () => {
        const context = buildNodeGenerationContext("config", [target(), image("a")], [edge("a")], "镜头前移");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["a"]);
        expect(frameReferenceIssue(context.imageCount)).toBeUndefined();
        await createPlatformGeneration(config(), "video", context.prompt, context.referenceImages);
        expect(harness.request.mock.calls[0][1]).toMatchObject({ referenceAssetIds: ["a"] });
    });

    it("rejects missing frames before any upload or generation request", async () => {
        const context = buildNodeGenerationContext("config", [target()], [], "镜头前移");
        expect(frameReferenceIssue(context.imageCount)).toContain("连接首帧");
        await expect(createPlatformGeneration(config(), "video", context.prompt, context.referenceImages)).rejects.toThrow("连接首帧");
        expect(harness.request).not.toHaveBeenCalled(); expect(harness.convert).not.toHaveBeenCalled();
    });

    it("keeps all three connected images and reports the excess instead of truncating it", async () => {
        const context = buildNodeGenerationContext("config", [target(), image("a"), image("b"), image("c")], [edge("a"), edge("b"), edge("c")], "镜头前移");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["a", "b", "c"]);
        expect(frameReferenceIssue(context.imageCount)).toContain("已选 3 张");
        await expect(createPlatformGeneration(config(), "video", context.prompt, context.referenceImages)).rejects.toThrow("最多支持 2 张");
        expect(harness.request).not.toHaveBeenCalled(); expect(harness.convert).not.toHaveBeenCalled();
    });

    it("lets explicit image tokens choose two of three connections in the exact token order", async () => {
        const prompt = "从 @[node:b] 过渡到 @[node:a]";
        const context = buildNodeGenerationContext("config", [target(), image("a"), image("b"), image("c")], [edge("a"), edge("b"), edge("c")], prompt);
        expect(context.referenceImages.map((item) => item.id)).toEqual(["b", "a"]);
        expect(context.prompt).not.toContain("@[node:");
        await createPlatformGeneration(config(), "video", context.prompt, context.referenceImages);
        expect(harness.request.mock.calls[0][1]).toMatchObject({ referenceAssetIds: ["b", "a"] });
    });

    it("uses connected frames when the prompt has text tokens but no image tokens", () => {
        const script = node("script", CanvasNodeType.Text, { content: "人物从树下走到门前" });
        const context = buildNodeGenerationContext("config", [target(), script, image("a"), image("b")], [edge("b"), edge("script"), edge("a")], "@[node:script]，保持运镜连贯");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["b", "a"]);
        expect(context.prompt).toContain("人物从树下走到门前"); expect(context.textCount).toBe(1);
    });

    it("expands groups in connection order and deduplicates images also connected directly", () => {
        const group = node("group", CanvasNodeType.Group);
        const nodes = [target(), group, image("a", "group"), image("b", "group")];
        const context = buildNodeGenerationContext("config", nodes, [edge("b"), edge("group"), edge("a"), edge("b")], "平滑转场");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["b", "a"]);
        expect(context.imageCount).toBe(2);
    });

    it("supports an explicit group token and direct child tokens without duplicate frames", () => {
        const nodes = [target(), node("group", CanvasNodeType.Group), image("a", "group"), image("b", "group")];
        const context = buildNodeGenerationContext("config", nodes, [edge("group")], "@[node:b] 再到 @[node:group]");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["b", "a"]);
        expect(context.imageCount).toBe(2);
    });

    it("does not replace a removed or unconnected explicit image with other connected images", () => {
        const nodes = [target(), image("a"), image("b"), image("c")];
        for (const prompt of ["@[node:c] 运动", "@[node:deleted-image] 运动"]) {
            const context = buildNodeGenerationContext("config", nodes, [edge("a"), edge("b")], prompt);
            expect(context.imageCount).toBe(0); expect(frameReferenceIssue(context.imageCount)).toContain("连接首帧");
        }
    });

    it("does not read an outgoing configuration's inputs as this configuration's frames", () => {
        const nodes = [target(), image("a"), image("b"), node("other-config", CanvasNodeType.Config), image("other")];
        const context = buildNodeGenerationContext("config", nodes, [edge("a"), edge("b"), edge("config", "other-config"), edge("other", "other-config")], "镜头前移");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["a", "b"]);
    });

    it("uses the same context path for reference-bar previews and generation, including current editor tokens", () => {
        const group = node("group", CanvasNodeType.Group);
        const nodes = [target(), group, image("a", "group"), image("b", "group"), image("c")];
        const connections = [edge("group"), edge("c")];
        const connectedNodes = [group, nodes[4]];
        for (const prompt of ["镜头前移", "@[node:c] 到 @[node:b]"]) {
            const submitted = buildNodeGenerationContext("config", nodes, connections, prompt, { frameMode: true });
            const preview = buildNodeGenerationContext("config", nodes, connectedNodes.map((source) => edge(source.id)), prompt, { frameMode: true });
            expect(preview.referenceImages).toEqual(submitted.referenceImages);
            expect(frameReferenceIssue(preview.imageCount)).toBe(frameReferenceIssue(submitted.imageCount));
        }
    });

    it("reverses exactly the chosen first and last frames without changing the original input list", async () => {
        const context = buildNodeGenerationContext("config", [target(), image("a"), image("b")], [edge("a"), edge("b")], "镜头前移");
        await createPlatformGeneration({ ...config(), videoFramesReversed: true }, "video", context.prompt, context.referenceImages);
        expect(harness.request.mock.calls[0][1]).toMatchObject({ referenceAssetIds: ["b", "a"] });
        expect(context.referenceImages.map((item) => item.id)).toEqual(["a", "b"]);
    });

    it("honors an explicitly inherited frame mode and leaves ordinary composer reference rules unchanged", () => {
        const plainTarget = target(); plainTarget.metadata!.videoMode = undefined;
        const nodes = [plainTarget, image("a"), image("b")]; const connections = [edge("a"), edge("b")];
        expect(buildNodeGenerationContext("config", nodes, connections, "镜头前移").imageCount).toBe(0);
        expect(buildNodeGenerationContext("config", nodes, connections, "镜头前移", { frameMode: true }).imageCount).toBe(2);
        plainTarget.metadata!.videoMode = "frames";
        expect(buildNodeGenerationContext("config", nodes, connections, "镜头前移", { frameMode: false }).imageCount).toBe(0);
    });
});
