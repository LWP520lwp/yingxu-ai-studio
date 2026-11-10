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

export function canvasSkillPrompt(payload: { prompt?: unknown; defaults?: { prompt?: unknown } }) {
    return typeof payload.defaults?.prompt === "string" ? payload.defaults.prompt : typeof payload.prompt === "string" ? payload.prompt : "";
}

export function textVideoPrompt(sourceNodeId: string, template = "") {
    const token = `@[node:${sourceNodeId}]`;
    const prompt = template.trim();
    return prompt.includes(token) ? prompt : [prompt, token].filter(Boolean).join("\n\n");
}

function positiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function selectGenerationModel(models: PlatformModel[], fallback: string, requested?: string, preferred?: string, requiresReference = false) {
    const available = models.filter((model) => model.available && (!requiresReference || model.caps?.supportsReferenceImages !== false));
    const find = (id?: string) => available.find((model) => model.id === id?.replace(/^platform::/, ""));
    return find(requested) || find(preferred) || find(fallback) || available[0];
}

export const selectVideoModel = (models: PlatformModel[], requested?: string, preferred?: string, requiresReference = false) => selectGenerationModel(models, "muse-service-video", requested, preferred, requiresReference);
export const selectImageModel = (models: PlatformModel[], requested?: string, preferred?: string, requiresReference = false) => selectGenerationModel(models, "muse-service-image", requested, preferred, requiresReference);

export function videoSkillMetadata(prepared: PreparedCanvasSkill, model: PlatformModel, sourceNodeId?: string, instruction = ""): CanvasNodeMetadata {
    // A recipe's default prompt is its method, not user-authored scene content.
    // Market-created video nodes therefore start empty (or with their source token).
    const prompt = sourceNodeId ? textVideoPrompt(sourceNodeId, instruction) : instruction;
    const width = positiveNumber(model.caps?.fixedWidth) ? model.caps.fixedWidth : prepared.defaults.width;
    const height = positiveNumber(model.caps?.fixedHeight) ? model.caps.fixedHeight : prepared.defaults.height;
    const duration = positiveNumber(model.caps?.fixedDuration) ? model.caps.fixedDuration : prepared.defaults.duration;
    return {
        status: "idle", generationMode: "video", model: `platform::${model.id}`,
        prompt, composerContent: prompt,
        // Keep editable user text separate from the recipe, which is resolved once at submission.
        videoSkillId: prepared.defaults.skillId || "", videoSkillVersion: prepared.defaults.skillVersion || "",
        videoSkillInputMode: "instruction",
        skillId: undefined, skillVersion: undefined,
        ...(positiveNumber(width) && positiveNumber(height) ? { size: `${width}x${height}`, vquality: String(height) } : {}),
        ...(positiveNumber(duration) ? { seconds: String(duration) } : {}),
        videoMode: prepared.requiresReference ? "reference" : "auto",
        generateAudio: "auto", watermark: "auto",
    };
}

export async function prepareTextVideo(options: {
    sourceNodeId: string;
    projectId: string;
    selected: CanvasVideoSkill | null;
    preferredModel?: string;
    signal: AbortSignal;
    getSourceNode: () => CanvasNodeData | undefined;
    isCurrentProject: () => boolean;
}) {
    const init = getPlatformInit();
    if (!init || init.project.id !== options.projectId || !options.isCurrentProject() || options.signal.aborted) throw platformAbortError();
    const source = options.getSourceNode();
    if (source?.type !== CanvasNodeType.Text) throw platformAbortError();
    if (!(source.metadata?.content || source.metadata?.prompt || "").trim()) throw new Error("请先在文本框中输入视频内容");

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    const stopListening = onPlatformInit((current) => {
        if (current.scopeId !== init.scopeId || current.project.id !== init.project.id) abort();
    });
    try {
        const selected = options.selected;
        const prepared: PreparedCanvasSkill = selected ? await platformRequest<PreparedCanvasSkill>("skills.prepare", {
            id: selected.id, version: selected.version, install: !selected.installed,
            sourceNodeId: source.id, text: `@[node:${source.id}]`,
        }, { signal: controller.signal, timeoutMs: 20_000 }) : {
            kind: "video", defaults: { prompt: `@[node:${source.id}]`, width: 1280, height: 720, duration: 8 }, requiresReference: false,
        };
        const current = getPlatformInit();
        const currentSource = options.getSourceNode();
        if (controller.signal.aborted || !options.isCurrentProject() || current?.scopeId !== init.scopeId || current.project.id !== init.project.id || currentSource?.id !== source.id || currentSource.type !== CanvasNodeType.Text) throw platformAbortError();
        if (!(currentSource.metadata?.content || currentSource.metadata?.prompt || "").trim()) throw new Error("源文本已清空，请先输入视频内容");
        if (prepared.kind !== "video" || !prepared.defaults) throw new Error("此 Skill 未返回有效的视频配置，请刷新 Skill 列表后重试");
        if (selected && (prepared.defaults.skillId !== selected.id || prepared.defaults.skillVersion !== selected.version)) throw new Error("Skill 版本已变化，请重新选择后准备视频");
        const model = selectVideoModel(current.models.video, prepared.defaults.model, options.preferredModel, prepared.requiresReference);
        if (!model) throw new Error(prepared.requiresReference ? "暂无支持参考图的视频通道，请先在我的账号池接入 Muse" : "暂无可用的视频通道，请先在我的账号池接入账号");
        return { source: currentSource, scopeId: current.scopeId, metadata: videoSkillMetadata(prepared, model, source.id, `@[node:${source.id}]`), requiresReference: Boolean(prepared.requiresReference) };
    } finally {
        stopListening();
        options.signal.removeEventListener("abort", abort);
    }
}
