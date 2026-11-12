import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { PlatformInit } from "./rpc";

const harness = vi.hoisted(() => ({
    init: null as PlatformInit | null,
    request: vi.fn(), convert: vi.fn(), uploadMedia: vi.fn(), notify: vi.fn(),
    catalogListeners: new Set<(init: PlatformInit) => void>(),
}));
vi.mock("./rpc", () => ({
    getPlatformInit: () => harness.init,
    waitForPlatformInit: async (options?: { signal?: AbortSignal }) => {
        if (options?.signal?.aborted) throw new DOMException("操作已取消", "AbortError");
        if (!harness.init) throw new Error("尚未初始化");
        return harness.init;
    },
    platformAbortError: () => new DOMException("操作已取消", "AbortError"),
    platformRequest: harness.request,
    notifyPlatformStatus: harness.notify,
    onPlatformInit: (listener: (init: PlatformInit) => void) => { harness.catalogListeners.add(listener); return () => harness.catalogListeners.delete(listener); },
}));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: harness.convert }));
vi.mock("@/services/file-storage", () => ({ uploadMediaFile: harness.uploadMedia }));
vi.mock("@/lib/localforage-storage", () => ({
    localForageStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));
import { createPlatformGeneration, generatePlatformImages, waitForPlatformGeneration, type PlatformGenerationTask } from "./generation";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { requestGeneration, requestImageQuestion } from "@/services/api/image";
import { requestAudioGeneration } from "@/services/api/audio";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";

const config = (patch: Partial<AiConfig> = {}): AiConfig => ({ ...defaultConfig, ...patch });
const reference = (patch: Partial<ReferenceImage> = {}): ReferenceImage => ({ id: "reference-one", name: "参考图.png", type: "image/png", dataUrl: "data:image/png;base64,YWJj", ...patch });
const task = (): PlatformGenerationTask => ({ id: "job-one", model: "muse-image", scopeId: "scope-one", projectId: "project-one" });
const job = (patch: Record<string, unknown> = {}) => ({ id: "job-one", kind: "image", projectId: "project-one", nodeId: "node-one", status: "queued", ...patch });

beforeEach(() => {
    harness.init = {
        scopeId: "scope-one", userId: "user-one", project: { id: "project-one", title: "项目一" },
        baseCanvasDocument: {}, snapshot: null, assets: [],
        models: { image: [{ id: "muse-image", available: true }], video: [{ id: "muse-video", available: true }] },
    };
    harness.request.mockReset(); harness.convert.mockReset(); harness.uploadMedia.mockReset(); harness.notify.mockReset();
    harness.convert.mockImplementation(async (image: ReferenceImage) => image.dataUrl);
    harness.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
        if (method === "jobs.create") return job({ kind: params.kind });
        if (method === "jobs.status") return job({ status: "succeeded", resultAssetId: "result-one", resultUrl: "/api/assets/result-one/content" });
        if (method === "assets.upload") return { id: "uploaded-one" };
        if (method === "assets.list") return [{ id: "result-one", mimeType: "video/webm" }];
        if (method === "jobs.cancel") return job({ status: "cancel_requested" });
        throw new Error(`Unexpected RPC: ${method}`);
    });
    useConfigStore.setState({ config: defaultConfig });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("supported platform generation", () => {
    function serviceReferences() {
        harness.init!.models.video = [{ id: "muse-service-video", available: true, caps: { supportsReferenceImages: true, maxReferenceImages: 4, supportedVideoModes: ["auto", "reference", "frames"] } }];
        harness.init!.assets = Array.from({ length: 4 }, (_, i) => ({ id: `source-${i}`, url: `/api/assets/source-${i}/content`, name: `图${i}`, mimeType: "image/png", size: 20 }));
        return harness.init!.assets.map((asset) => reference({ id: asset.id, dataUrl: asset.url }));
    }
    it("submits four durable references in declared reference mode without reuploading", async () => {
        const references = serviceReferences();
        await createVideoGenerationTask(config({ model: "platform::muse-service-video", videoMode: "reference" }), "连贯追逐", references);
        expect(harness.convert).not.toHaveBeenCalled();
        expect(harness.request.mock.calls).toHaveLength(1);
        expect(harness.request.mock.calls[0][1]).toMatchObject({ videoMode: "reference", referenceAssetIds: ["source-0", "source-1", "source-2", "source-3"] });
    });
    it("maps reversed first and last frames in the explicit frames request", async () => {
        const references = serviceReferences().slice(0, 2);
        await createVideoGenerationTask(config({ model: "platform::muse-service-video", videoMode: "frames", videoFramesReversed: true }), "平滑转场", references);
        expect(harness.request.mock.calls[0][1]).toMatchObject({ videoMode: "frames", referenceAssetIds: ["source-1", "source-0"] });
    });
    it("rejects missing or excess frames before uploads or Skill preparation", async () => {
        const references = serviceReferences();
        const selected = config({ model: "platform::muse-service-video", videoMode: "frames" });
        await expect(createVideoGenerationTask(selected, "转场", [])).rejects.toThrow("连接首帧");
        await expect(createVideoGenerationTask(selected, "转场", references.slice(0, 3))).rejects.toThrow("最多支持 2 张");
        expect(harness.request).not.toHaveBeenCalled();
        expect(harness.convert).not.toHaveBeenCalled();
    });
    it("blocks an unreviewed legacy Skill before any request, preserving its original text", async () => {
        await expect(createVideoGenerationTask(config({ model: "platform::muse-video", videoSkillReviewRequired: true, videoSkillId: "fight-video", videoSkillVersion: "1.0.0" }), "原文与配方尚未分开")).rejects.toThrow("确认旧配置");
        expect(harness.request).not.toHaveBeenCalled();
    });
    it("puts the selected video Skill's prepared text on the real job alongside its reference image", async () => {
        const original = harness.request.getMockImplementation()!;
        harness.request.mockImplementation(async (method: string, params: Record<string, unknown>) => method === "skills.prompt" ? { prompt: `动作配方：${params.text}\n参考画面保持一致`, skillId: params.id, skillVersion: params.version } : original(method, params));
        harness.init!.assets = [{ id: "source-one", url: "/api/assets/source-one/content", name: "角色", mimeType: "image/png", size: 20 }];
        await createVideoGenerationTask(config({ model: "platform::muse-video", videoSkillId: "fight-video", videoSkillVersion: "1.0.1", videoSeconds: "8" }), "雨中交手", [reference({ dataUrl: "/api/assets/source-one/content" })]);
        expect(harness.request.mock.calls[0]).toEqual(["skills.prompt", { id: "fight-video", version: "1.0.1", text: "雨中交手", referenceCount: 1 }, undefined]);
        const submission = harness.request.mock.calls.find((call) => call[0] === "jobs.create")![1];
        expect(submission).toMatchObject({ kind: "video", prompt: "动作配方：雨中交手\n参考画面保持一致", referenceAssetIds: ["source-one"], skillId: "fight-video", skillVersion: "1.0.1" });
    });
    it("carries imported Skill provenance into a real generation job and preserves already-applied prompt recipes", async () => {
        const original = harness.request.getMockImplementation()!;
        const privateId = "private-" + "a".repeat(48);
        harness.request.mockImplementation(async (method: string, params: Record<string, unknown>) => method === "skills.prompt" ? { prompt: `轨道镜头：${params.text}`, skillId: params.id, skillVersion: params.version } : original(method, params));
        await createVideoGenerationTask(config({ model: "platform::muse-video", videoSkillId: privateId, videoSkillVersion: "1.0.0" }), "卫星运动");
        expect(harness.request.mock.calls.find((call) => call[0] === "jobs.create")![1]).toMatchObject({ prompt: "轨道镜头：卫星运动", skillId: privateId, skillVersion: "1.0.0" });
        harness.request.mockClear();
        await createPlatformGeneration(config({ appliedSkillId: privateId, appliedSkillVersion: "1.0.0" }), "image", "已应用的配方：地球示意");
        expect(harness.request.mock.calls.some((call) => call[0] === "skills.prompt")).toBe(false);
        expect(harness.request.mock.calls.find((call) => call[0] === "jobs.create")![1]).toMatchObject({ prompt: "已应用的配方：地球示意", skillId: privateId, skillVersion: "1.0.0" });
    });
    it("never applies a video Skill to image jobs and never submits if recipe preparation fails", async () => {
        await createPlatformGeneration(config({ videoSkillId: "fight-video", videoSkillVersion: "1.0.1" }), "image", "森林");
        expect(harness.request.mock.calls.some((call) => call[0] === "skills.prompt")).toBe(false);
        harness.request.mockReset().mockRejectedValue(new Error("Skill版本已变化"));
        await expect(createVideoGenerationTask(config({ model: "platform::muse-video", videoSkillId: "fight-video", videoSkillVersion: "1.0.1" }), "雨中交手")).rejects.toThrow("版本已变化");
        expect(harness.request.mock.calls.map((call) => call[0])).toEqual(["skills.prompt"]);
    });
    it("blocks reference images before uploading to a text-only custom channel", async () => {
        harness.init!.models.image = [{ id: "channel:personal:gpt-image-1", available: true, caps: { supportsReferenceImages: false } }];
        await expect(createPlatformGeneration(config({ model: "platform::channel:personal:gpt-image-1" }), "image", "森林", [reference()])).rejects.toThrow("移除参考图");
        expect(harness.convert).not.toHaveBeenCalled();
        expect(harness.request).not.toHaveBeenCalled();
    });
    it("maps explicit image dimensions, prompt and uploaded references without sending provider credentials", async () => {
        await createPlatformGeneration(config({ size: "1536x1024", systemPrompt: " 写实摄影 ", apiKey: "must-stay-local", baseUrl: "https://secret-provider.invalid" }), "image", " 森林 ", [reference()]);
        expect(harness.request.mock.calls.map((call) => call[0])).toEqual(["assets.upload", "jobs.create"]);
        expect(harness.request.mock.calls[1][1]).toMatchObject({
            projectId: "project-one", kind: "image", prompt: "写实摄影\n\n森林", model: "muse-image",
            width: 1536, height: 1024, referenceAssetIds: ["uploaded-one"],
        });
        expect(JSON.stringify(harness.request.mock.calls)).not.toContain("must-stay-local");
        expect(JSON.stringify(harness.request.mock.calls)).not.toContain("secret-provider");
    });

    it("reuses known durable references and maps video aspect ratio, resolution and duration", async () => {
        harness.init!.assets = [{ id: "source-one", url: "/api/assets/source-one/content", name: "原图", mimeType: "image/png", size: 20 }];
        await createVideoGenerationTask(config({ model: "platform::muse-video", size: "9:16", vquality: "1080", videoSeconds: "8" }), "镜头前移", [reference({ dataUrl: "/api/assets/source-one/content" })]);
        expect(harness.convert).not.toHaveBeenCalled();
        expect(harness.request).toHaveBeenCalledTimes(1);
        expect(harness.request.mock.calls[0][1]).toMatchObject({ kind: "video", model: "muse-video", width: 1080, height: 1920, duration: 8, referenceAssetIds: ["source-one"] });
    });

    it("creates distinct durable image jobs for the requested count", async () => {
        const results = await requestGeneration(config({ count: "2", size: "16:9" }), "森林");
        const submissions = harness.request.mock.calls.filter((call) => call[0] === "jobs.create");
        expect(submissions).toHaveLength(2);
        expect(submissions[0][1]).toMatchObject({ width: 1536, height: 864 });
        expect(submissions[0][1].idempotencyKey).not.toEqual(submissions[1][1].idempotencyKey);
        expect(results).toHaveLength(2);
        expect(results[0].dataUrl).toBe("/api/assets/result-one/content");
    });

    it("keeps a custom video ratio instead of snapping it to a nearby preset", async () => {
        await createVideoGenerationTask(config({ model: "platform::muse-video", size: "2:1", vquality: "720" }), "横向镜头");
        expect(harness.request.mock.calls[0][1]).toMatchObject({ width: 1440, height: 720 });
    });

    it("preserves the real video MIME type and stores the existing durable URL without reupload", async () => {
        harness.request.mockResolvedValueOnce(job({ kind: "video", status: "succeeded", resultAssetId: "result-one", resultUrl: "/api/assets/result-one/content" }));
        const state = await pollVideoGenerationTask(config(), { ...task(), provider: "platform" });
        expect(state.status).toBe("completed");
        if (state.status !== "completed") throw new Error("Expected completed video");
        expect(await storeGeneratedVideo(state.result)).toMatchObject({ mimeType: "video/webm", url: "/api/assets/result-one/content" });
        expect(harness.uploadMedia).not.toHaveBeenCalled();
    });

    it("does not invent an mp4 format when durable video metadata is missing", async () => {
        harness.request.mockResolvedValueOnce(job({ kind: "video", status: "succeeded", resultAssetId: "missing", resultUrl: "/api/assets/missing/content" }));
        await expect(pollVideoGenerationTask(config(), { ...task(), provider: "platform" })).rejects.toThrow("元数据尚未确认");
        await expect(storeGeneratedVideo({ url: "/api/assets/missing/content" })).rejects.toThrow("素材格式");
        expect(harness.uploadMedia).not.toHaveBeenCalled();
    });
});

describe("unsupported settings fail before upload or submission", () => {
    it.each([
        ["image", { quality: "high" }, "图片质量"],
        ["image", { background: "transparent" }, "图片背景"],
        ["image", { background: "opaque" }, "图片背景"],
        ["video", { videoGenerateAudio: "true" }, "视频音轨"],
        ["video", { videoGenerateAudio: "false" }, "视频音轨"],
        ["video", { videoWatermark: "true" }, "视频水印"],
        ["video", { videoWatermark: "false" }, "视频水印"],
        ["video", { videoMode: "frames" }, "首尾帧"],
        ["video", { videoMode: "edit" }, "视频模式"],
    ] as const)("rejects %s settings %j", async (kind, patch, message) => {
        await expect(createPlatformGeneration(config({ model: kind === "video" ? "platform::muse-video" : "platform::muse-image", ...patch }), kind, "森林", [reference()])).rejects.toThrow(message);
        expect(harness.request).not.toHaveBeenCalled();
        expect(harness.convert).not.toHaveBeenCalled();
    });

    it("rejects multiple video frames and video/audio references without touching the platform", async () => {
        const videoConfig = config({ model: "platform::muse-video" });
        await expect(createVideoGenerationTask(videoConfig, "森林", [reference(), reference()])).rejects.toThrow("最多支持 1 张参考图");
        await expect(createVideoGenerationTask(videoConfig, "森林", [], { videos: [{ id: "v", name: "片段", url: "blob:video", type: "video/mp4" }] })).rejects.toThrow("视频或音频");
        await expect(createVideoGenerationTask(videoConfig, "森林", [], { audios: [{ id: "a", name: "声音", url: "blob:audio", type: "audio/wav" }] })).rejects.toThrow("视频或音频");
        expect(harness.request).not.toHaveBeenCalled();
    });

    it.each([
        ["image", { size: "invalid-size" }, "尺寸无效"],
        ["image", { size: "8192x1024" }, "64–4096"],
        ["video", { videoSeconds: "30" }, "2–20 秒"],
        ["video", { vquality: "2k" }, "分辨率无效"],
    ] as const)("rejects invalid %s bounds %j", async (kind, patch, message) => {
        await expect(createPlatformGeneration(config({ model: kind === "video" ? "platform::muse-video" : "platform::muse-image", ...patch }), kind, "森林", [reference()])).rejects.toThrow(message);
        expect(harness.request).not.toHaveBeenCalled();
    });

    it.each(["0", "-2", "1.5", "16", "invalid"])("rejects invalid image count %s instead of silently changing it", async (count) => {
        await expect(generatePlatformImages(config({ count }), "森林")).rejects.toThrow("1–15 的整数");
        expect(harness.request).not.toHaveBeenCalled();
    });

    it("blocks unavailable models, text and audio generation", async () => {
        harness.init!.models.image[0].available = false;
        await expect(generatePlatformImages(config(), "森林")).rejects.toThrow("当前不可用");
        await expect(requestImageQuestion(config(), [], () => undefined)).rejects.toThrow("文本生成");
        await expect(requestAudioGeneration(config(), "朗读")).rejects.toThrow("音频生成");
        expect(harness.request).not.toHaveBeenCalled();
    });

    it("uses automatic defaults and preserves explicit unsupported selections for validation", () => {
        expect(defaultConfig).toMatchObject({ videoGenerateAudio: "auto", videoWatermark: "auto", videoMode: "reference" });
        useConfigStore.getState().updateConfig("videoGenerateAudio", "false");
        useConfigStore.getState().updateConfig("quality", "high");
        expect(useConfigStore.getState().config).toMatchObject({ videoGenerateAudio: "false", quality: "high" });
    });

    it("refreshes the model catalog after account changes without exposing provider credentials", () => {
        harness.init!.models.image = [{ id: "new-image-channel", available: true }];
        for (const listener of harness.catalogListeners) listener(harness.init!);
        const refreshed = useConfigStore.getState().config;
        expect(refreshed.channels[0].models.some((model) => model.name === "new-image-channel")).toBe(true);
        expect(refreshed).toMatchObject({ baseUrl: "", apiKey: "" });
        expect(refreshed.channels[0]).toMatchObject({ baseUrl: "", apiKey: "" });
    });
});

describe("cancellation and uncertain external state", () => {
    it("does not upload or submit when the caller is already cancelled", async () => {
        const controller = new AbortController(); controller.abort();
        await expect(createPlatformGeneration(config(), "image", "森林", [reference()], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        expect(harness.request).not.toHaveBeenCalled();
    });

    it("cancels the durable job when waiting is already cancelled", async () => {
        const controller = new AbortController(); controller.abort();
        await expect(waitForPlatformGeneration(task(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        expect(harness.request.mock.calls.map((call) => call[0])).toEqual(["jobs.cancel"]);
    });

    it("cancels during the polling delay and never submits another generation", async () => {
        vi.useFakeTimers();
        harness.request.mockResolvedValueOnce(job({ status: "running" }));
        const controller = new AbortController();
        const waiting = waitForPlatformGeneration(task(), { signal: controller.signal });
        const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
        await vi.waitFor(() => expect(harness.request).toHaveBeenCalledWith("jobs.status", { id: "job-one" }, { signal: controller.signal }));
        controller.abort();
        await rejected;
        expect(harness.request.mock.calls.map((call) => call[0])).toEqual(["jobs.status", "jobs.cancel"]);
    });

    it("requests cancellation if the create result races with abort", async () => {
        const controller = new AbortController();
        harness.request.mockImplementationOnce(async () => { controller.abort(); return job(); });
        await expect(createPlatformGeneration(config(), "image", "森林", [], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        expect(harness.request.mock.calls.map((call) => call[0])).toEqual(["jobs.create", "jobs.cancel"]);
    });

    it("stops on uncertain external state without replaying the request", async () => {
        harness.request.mockResolvedValueOnce(job({ status: "unknown_external" }));
        await expect(waitForPlatformGeneration(task())).rejects.toThrow("不会自动重复提交");
        expect(harness.request.mock.calls.map((call) => call[0])).toEqual(["jobs.status"]);
    });

    it("passes cancellation through the video metadata lookup", async () => {
        const controller = new AbortController();
        harness.request.mockResolvedValueOnce(job({ kind: "video", status: "succeeded", resultAssetId: "result-one", resultUrl: "/api/assets/result-one/content" }));
        harness.request.mockImplementationOnce(async () => { controller.abort(); throw new DOMException("取消", "AbortError"); });
        await expect(waitForVideoGenerationTask(config(), { ...task(), provider: "platform" }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        expect(harness.request.mock.calls[1]).toEqual(["assets.list", {}, { signal: controller.signal }]);
    });
});
