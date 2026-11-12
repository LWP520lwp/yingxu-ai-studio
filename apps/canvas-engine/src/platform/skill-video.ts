import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { getPlatformInit, onPlatformInit, platformAbortError, platformRequest, type PlatformModel } from "./rpc";

export type CanvasVideoSkill = {
    id: string;
    name: string;
    version: string;
    installed: boolean;
    requiresReference: boolean;
};

export type PreparedCanvasSkill = {
    kind: "image" | "video";
    defaults: {
        skillId?: string;
        skillVersion?: string;
        prompt?: string;
        model?: string;
        width?: number;
        height?: number;
        duration?: number;
    };
    requiresReference?: boolean;
};

type SkillPromptPayload = { prompt?: unknown; defaults?: { prompt?: unknown } };

export function canvasSkillPrompt(payload: SkillPromptPayload): string {
    if (typeof payload.defaults?.prompt === "string") return payload.defaults.prompt;
    return typeof payload.prompt === "string" ? payload.prompt : "";
}

export function textVideoPrompt(sourceNodeId: string, template = ""): string {
    const sourceReference = `@[node:${sourceNodeId}]`;
    const instruction = template.trim();
    if (instruction.includes(sourceReference)) return instruction;
    return instruction ? `${instruction}\n\n${sourceReference}` : sourceReference;
}

function positive(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function chooseModel(
    catalog: readonly PlatformModel[],
    fallbackId: string,
    requestedId?: string,
    preferredId?: string,
    needsReference = false,
): PlatformModel | undefined {
    const candidates = catalog.filter((model) => model.available && (!needsReference || model.caps?.supportsReferenceImages !== false));
    const find = (value?: string) => {
        const id = value?.replace(/^platform::/, "");
        return id ? candidates.find((model) => model.id === id) : undefined;
    };
    return find(requestedId) ?? find(preferredId) ?? find(fallbackId) ?? candidates[0];
}

export const selectVideoModel = (models: PlatformModel[], requested?: string, preferred?: string, requiresReference = false) =>
    chooseModel(models, "muse-service-video", requested, preferred, requiresReference);
export const selectImageModel = (models: PlatformModel[], requested?: string, preferred?: string, requiresReference = false) =>
    chooseModel(models, "muse-service-image", requested, preferred, requiresReference);

export function videoSkillMetadata(prepared: PreparedCanvasSkill, model: PlatformModel, sourceNodeId?: string, instruction = ""): CanvasNodeMetadata {
    // Keep recipe instructions separate from editable scene text. The source token is resolved on submit.
    const prompt = sourceNodeId ? textVideoPrompt(sourceNodeId, instruction) : instruction;
    const width = positive(model.caps?.fixedWidth) ? model.caps.fixedWidth : prepared.defaults.width;
    const height = positive(model.caps?.fixedHeight) ? model.caps.fixedHeight : prepared.defaults.height;
    const duration = positive(model.caps?.fixedDuration) ? model.caps.fixedDuration : prepared.defaults.duration;
    return {
        status: "idle",
        generationMode: "video",
        model: `platform::${model.id}`,
        prompt,
        composerContent: prompt,
        videoSkillId: prepared.defaults.skillId || "",
        videoSkillVersion: prepared.defaults.skillVersion || "",
        videoSkillInputMode: "instruction",
        skillId: undefined,
        skillVersion: undefined,
        ...(positive(width) && positive(height) ? { size: `${width}x${height}`, vquality: String(height) } : {}),
        ...(positive(duration) ? { seconds: String(duration) } : {}),
        videoMode: prepared.requiresReference ? "reference" : "auto",
        generateAudio: "auto",
        watermark: "auto",
    };
}

type PrepareTextVideoOptions = {
    sourceNodeId: string;
    projectId: string;
    selected: CanvasVideoSkill | null;
    preferredModel?: string;
    signal: AbortSignal;
    getSourceNode: () => CanvasNodeData | undefined;
    isCurrentProject: () => boolean;
};

function readSource(options: PrepareTextVideoOptions): CanvasNodeData {
    const node = options.getSourceNode();
    if (!node || node.id !== options.sourceNodeId || node.type !== CanvasNodeType.Text) throw platformAbortError();
    if (!(node.metadata?.content || node.metadata?.prompt || "").trim()) throw new Error("请先在文本框中输入视频内容");
    return node;
}

export async function prepareTextVideo(options: PrepareTextVideoOptions) {
    const initial = getPlatformInit();
    if (!initial || initial.project.id !== options.projectId || !options.isCurrentProject() || options.signal.aborted) throw platformAbortError();
    const source = readSource(options);
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    options.signal.addEventListener("abort", abortRequest, { once: true });
    const stopWatching = onPlatformInit((current) => {
        if (current.scopeId !== initial.scopeId || current.project.id !== initial.project.id) abortRequest();
    });

    try {
        const selected = options.selected;
        const prepared: PreparedCanvasSkill = selected
            ? await platformRequest<PreparedCanvasSkill>("skills.prepare", {
                id: selected.id,
                version: selected.version,
                install: !selected.installed,
                sourceNodeId: source.id,
                text: `@[node:${source.id}]`,
            }, { signal: requestController.signal, timeoutMs: 20_000 })
            : { kind: "video", defaults: { prompt: `@[node:${source.id}]`, width: 1280, height: 720, duration: 8 } };

        const current = getPlatformInit();
        const latestSource = readSource(options);
        if (requestController.signal.aborted || !options.isCurrentProject() || current?.scopeId !== initial.scopeId || current.project.id !== initial.project.id || latestSource.id !== source.id) throw platformAbortError();
        if (prepared.kind !== "video" || !prepared.defaults) throw new Error("此 Skill 未返回有效的视频配置，请刷新 Skill 列表后重试");
        if (selected && (prepared.defaults.skillId !== selected.id || prepared.defaults.skillVersion !== selected.version)) throw new Error("Skill 版本已变化，请重新选择后准备视频");

        const model = selectVideoModel(current.models.video, prepared.defaults.model, options.preferredModel, prepared.requiresReference);
        if (!model) {
            const reason = prepared.requiresReference ? "暂无支持参考图的视频通道，请先在我的账号池接入 Muse" : "暂无可用的视频通道，请先在我的账号池接入账号";
            throw new Error(reason);
        }
        return {
            source: latestSource,
            scopeId: current.scopeId,
            metadata: videoSkillMetadata(prepared, model, source.id, `@[node:${source.id}]`),
            requiresReference: Boolean(prepared.requiresReference),
        };
    } finally {
        stopWatching();
        options.signal.removeEventListener("abort", abortRequest);
    }
}
