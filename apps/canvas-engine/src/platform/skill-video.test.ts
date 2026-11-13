import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { PlatformInit } from "./rpc";

const harness = vi.hoisted(() => ({
    init: null as PlatformInit | null,
    request: vi.fn(),
    listeners: new Set<(init: PlatformInit) => void>(),
}));
vi.mock("./rpc", () => ({
    getPlatformInit: () => harness.init,
    platformRequest: harness.request,
    platformAbortError: () => new DOMException("操作已取消", "AbortError"),
    onPlatformInit: (listener: (init: PlatformInit) => void) => {
        harness.listeners.add(listener);
        if (harness.init) listener(harness.init);
        return () => harness.listeners.delete(listener);
    },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/atlas-engine/model/node-registry", () => ({ getAtlasNodeDefinition: () => undefined }));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: vi.fn() }));

import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { canvasSkillPrompt, prepareTextVideo, selectImageModel, selectVideoModel, textVideoPrompt, videoSkillMetadata, type CanvasVideoSkill, type PreparedCanvasSkill } from "./skill-video";

const skill: CanvasVideoSkill = { id: "action-technique", name: "打斗技巧", version: "1.0.0", installed: false, requiresReference: false };
const sourceNode = (): CanvasNodeData => ({ id: "text-one", type: CanvasNodeType.Text, title: "分镜", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "第一版分镜" } });
const prepared = (patch: Partial<PreparedCanvasSkill> = {}): PreparedCanvasSkill => ({
    kind: "video", defaults: { skillId: skill.id, skillVersion: skill.version, prompt: "连续镜头\n\n@[node:text-one]", model: "muse-video", width: 1280, height: 720, duration: 8 }, ...patch,
});
function options(patch: Partial<Parameters<typeof prepareTextVideo>[0]> = {}) {
    return { sourceNodeId: "text-one", projectId: "project-one", selected: skill, preferredModel: "platform::muse-video", signal: new AbortController().signal, getSourceNode: sourceNode, isCurrentProject: () => true, ...patch };
}

beforeEach(() => {
    harness.init = {
        scopeId: "scope-one", userId: "user-one", project: { id: "project-one", title: "项目" },
        baseCanvasDocument: {}, snapshot: null, assets: [],
        models: { image: [], video: [{ id: "muse-video", available: true }] },
    };
    harness.listeners.clear();
    harness.request.mockReset();
    harness.request.mockResolvedValue(prepared());
});

describe("video preparation templates and model capabilities", () => {
    it("reads Skill defaults.prompt rather than losing the prepared template", () => {
        expect(canvasSkillPrompt({ prompt: "旧字段", defaults: { prompt: "模板字段" } })).toBe("模板字段");
        expect(canvasSkillPrompt({ prompt: "素材提示词" })).toBe("素材提示词");
        expect(canvasSkillPrompt({ defaults: { prompt: "" }, prompt: "旧字段" })).toBe("");
    });

    it("keeps a source token once and resolves the latest source edits at generation time", () => {
        const template = textVideoPrompt("text-one", "分镜转换");
        expect(template).toBe("分镜转换\n\n@[node:text-one]");
        expect(textVideoPrompt("text-one", template)).toBe(template);
        const source = sourceNode();
        const metadata = videoSkillMetadata(prepared({ defaults: { prompt: template } }), { id: "muse-video", available: true }, source.id);
        const config: CanvasNodeData = { ...source, id: "config-one", type: CanvasNodeType.Config, metadata };
        const connections = [{ id: "edge", fromNodeId: source.id, toNodeId: config.id }];
        const first = buildNodeGenerationContext(config.id, [source, config], connections, metadata.prompt!);
        expect(first.prompt).toContain("第一版分镜");
        source.metadata!.content = "修改后的分镜";
        const second = buildNodeGenerationContext(config.id, [source, config], connections, metadata.prompt!);
        expect(second.prompt).toContain("修改后的分镜");
        expect(second.prompt).not.toContain("第一版分镜");
        expect(metadata.prompt).not.toContain("第一版分镜");
        expect(second.textCount).toBe(1);
    });

    it("creates a source-only prompt when the selected Skill has no user instruction", () => {
        expect(textVideoPrompt("text-two", "   ")).toBe("@[node:text-two]");
        expect(textVideoPrompt("text-two", "先固定景别\n\n@[node:text-two]")).toBe("先固定景别\n\n@[node:text-two]");
    });

    it("selects available requested/default models and otherwise falls back to the shared Muse channel", () => {
        const models = [{ id: "muse-video", available: false }, { id: "doubao-video", available: true }, { id: "muse-service-video", available: true }];
        expect(selectVideoModel(models, "platform::doubao-video")?.id).toBe("doubao-video");
        expect(selectVideoModel(models, "muse-video", "platform::doubao-video")?.id).toBe("doubao-video");
        expect(selectVideoModel(models, "muse-video")?.id).toBe("muse-service-video");
        expect(selectVideoModel([{ id: "muse-video", available: false }])).toBeUndefined();
    });

    it("requires an image-capable model for image to video skills", () => {
        const models = [{ id: "doubao-video", available: true, caps: { supportsReferenceImages: false } }, { id: "muse-service-video", available: true, caps: { supportsReferenceImages: true } }];
        expect(selectVideoModel(models, "doubao-video", undefined, true)?.id).toBe("muse-service-video");
        expect(selectVideoModel(models.slice(0, 1), "doubao-video", undefined, true)).toBeUndefined();
    });

    it("honors the chosen model fixed dimensions/duration and retains Skill provenance", () => {
        expect(videoSkillMetadata(prepared(), { id: "doubao-video", available: true, caps: { fixedWidth: 1280, fixedHeight: 720, fixedDuration: 10 } }, "text-one")).toMatchObject({
            generationMode: "video", model: "platform::doubao-video", size: "1280x720", vquality: "720", seconds: "10",
            videoSkillId: skill.id, videoSkillVersion: skill.version, skillId: undefined, composerContent: "@[node:text-one]", videoMode: "auto",
        });
        expect(videoSkillMetadata(prepared({ requiresReference: true }), { id: "muse-video", available: true }).videoMode).toBe("reference");
    });
});

describe("scoped text to video preparation", () => {
    it("explicitly consents to installing only the selected version and never creates a generation job", async () => {
        const result = await prepareTextVideo(options());
        expect(harness.request).toHaveBeenCalledTimes(1);
        expect(harness.request).toHaveBeenCalledWith("skills.prepare", {
            id: skill.id, version: skill.version, install: true, sourceNodeId: "text-one", text: "@[node:text-one]",
        }, { signal: expect.any(AbortSignal), timeoutMs: 20_000 });
        expect(result.metadata).toMatchObject({ videoSkillId: skill.id, videoSkillVersion: skill.version, skillId: undefined, prompt: "@[node:text-one]", composerContent: "@[node:text-one]", generationMode: "video", status: "idle" });
        expect(result.metadata.prompt).not.toContain("连续镜头");
        expect(harness.listeners.size).toBe(0);
    });

    it("does not request installation for the installed version", async () => {
        await prepareTextVideo(options({ selected: { ...skill, installed: true } }));
        expect(harness.request.mock.calls[0][1].install).toBe(false);
    });

    it("prepares a plain dynamic video config without calling the Skill or generation API", async () => {
        harness.init!.models.video = [{ id: "muse-video", available: false }, { id: "muse-service-video", available: true }];
        const result = await prepareTextVideo(options({ selected: null }));
        expect(harness.request).not.toHaveBeenCalled();
        expect(result.metadata).toMatchObject({ model: "platform::muse-service-video", prompt: "@[node:text-one]", composerContent: "@[node:text-one]", generationMode: "video" });
    });

    it("aborts the preparation when the platform session changes", async () => {
        let resolveRequest!: (value: PreparedCanvasSkill) => void;
        harness.request.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
        const pending = prepareTextVideo(options());
        const signal = harness.request.mock.calls[0][2].signal as AbortSignal;
        harness.init = { ...harness.init!, scopeId: "scope-two" };
        harness.listeners.forEach((listener) => listener(harness.init!));
        expect(signal.aborted).toBe(true);
        resolveRequest(prepared());
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(harness.listeners.size).toBe(0);
    });

    it.each(["source-deleted", "source-type", "project"])("discards an async result after %s changes", async (change) => {
        let source: CanvasNodeData | undefined = sourceNode();
        let currentProject = true;
        harness.request.mockImplementation(async () => {
            if (change === "source-deleted") source = undefined;
            if (change === "source-type") source = { ...source!, type: CanvasNodeType.Image };
            if (change === "project") currentProject = false;
            return prepared();
        });
        await expect(prepareTextVideo(options({ getSourceNode: () => source, isCurrentProject: () => currentProject }))).rejects.toMatchObject({ name: "AbortError" });
    });

    it("rejects a changed Skill version before inserting a configuration", async () => {
        harness.request.mockResolvedValue(prepared({ defaults: { skillId: skill.id, skillVersion: "2.0.0", prompt: "新版本" } }));
        await expect(prepareTextVideo(options())).rejects.toThrow("版本已变化");
    });

    it("prevents empty text or unavailable model preparation", async () => {
        await expect(prepareTextVideo(options({ getSourceNode: () => ({ ...sourceNode(), metadata: { content: " " } }) }))).rejects.toThrow("输入视频内容");
        expect(harness.request).not.toHaveBeenCalled();
        harness.init!.models.video = [];
        await expect(prepareTextVideo(options({ selected: null }))).rejects.toThrow("暂无可用的视频通道");
    });
});

// Imported recipes may name an unavailable personal provider on another deployment.
it("selects an available image channel for portable Skill recipes", () => {
    const models = [
        { id: "muse-image", available: false },
        { id: "muse-service-image", available: true, caps: { supportsReferenceImages: true } },
        { id: "channel:custom:gpt-image-1", available: true, caps: { supportsReferenceImages: false } },
    ];
    expect(selectImageModel(models, "muse-image")?.id).toBe("muse-service-image");
    expect(selectImageModel(models, undefined, "platform::channel:custom:gpt-image-1")?.id).toBe("channel:custom:gpt-image-1");
    expect(selectImageModel(models, "channel:custom:gpt-image-1", undefined, true)?.id).toBe("muse-service-image");
    expect(selectImageModel(models.map((model) => ({ ...model, available: false })))).toBeUndefined();
});
