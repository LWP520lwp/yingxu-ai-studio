import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { imageSizePresets, inferVideoRatio, parseAspectRatio, parsePixelSize, readVideoDimensions } from "@/lib/media-size";
import { imageToDataUrl } from "@/services/image-storage";
import { getPlatformInit, platformAbortError, platformRequest, waitForPlatformInit, type PlatformAsset, type PlatformRequestOptions } from "./rpc";

export type PlatformJob = {
    id: string;
    status: "queued" | "running" | "waiting_provider" | "succeeded" | "failed" | "cancel_requested" | "cancelled" | "unknown_external";
    kind: "image" | "video";
    projectId: string;
    nodeId: string;
    resultAssetId?: string | null;
    resultUrl?: string | null;
    error?: string | null;
};
export type PlatformGenerationTask = { id: string; model: string; scopeId: string; projectId: string };
const terminalFailures = new Set<PlatformJob["status"]>(["failed", "cancelled", "unknown_external"]);

export function unsupportedGeneration(kind: "text" | "audio"): never {
    throw new Error(kind === "audio" ? "平台暂未开放音频生成；可以上传、播放和编辑音频素材" : "平台暂未开放文本生成；可以编辑文本、提示词并用作生成输入");
}

function checkScope(scopeId: string, signal?: AbortSignal) {
    if (signal?.aborted || getPlatformInit()?.scopeId !== scopeId) throw platformAbortError();
}

function rawModel(value: string) { return value.includes("::") ? value.slice(value.indexOf("::") + 2) : value; }

function validateSupportedOptions(config: AiConfig, kind: "image" | "video", referenceCount: number) {
    const explicit = (value: string) => Boolean(value?.trim() && value.trim() !== "auto");
    if (kind === "image") {
        if (explicit(config.quality)) throw new Error("当前平台暂不支持指定图片质量，请将质量设为自动后再生成");
        if (explicit(config.background)) throw new Error("当前平台暂不支持指定图片背景或透明背景，请将背景设为自动后再生成");
    } else {
        if (explicit(config.videoGenerateAudio)) throw new Error("当前平台暂不支持控制视频音轨，请将音轨设为自动后再生成");
        if (explicit(config.videoWatermark)) throw new Error("当前平台暂不支持控制视频水印，请将水印设为自动后再生成");
        if (config.videoMode && !["auto", "reference", "frames"].includes(config.videoMode)) throw new Error("请选择自动、全能参考或首尾帧视频模式");
        if (config.vquality && !/^(?:auto|low|medium|high|[1-9]\d*p?)$/.test(config.vquality)) throw new Error("视频分辨率无效，请使用有效的像素高度或自动");
    }
}

function dimensions(config: AiConfig, kind: "image" | "video") {
    if (config.size && config.size !== "auto" && !parsePixelSize(config.size) && !parseAspectRatio(config.size)) throw new Error("生成尺寸无效，请使用宽x高、宽:高或自动");
    if (kind === "video") return readVideoDimensions(config.size, config.vquality, parseAspectRatio(config.size) ? config.size : inferVideoRatio(config.size || "16:9"));
    const pixels = parsePixelSize(config.size);
    if (pixels) return pixels;
    const preset = parsePixelSize(imageSizePresets["1k"][config.size] || "");
    if (preset) return preset;
    const ratio = parseAspectRatio(config.size || "1:1");
    if (!ratio) return { width: 1024, height: 1024 };
    const shortSide = 1024;
    return ratio.width >= ratio.height
        ? { width: Math.round((shortSide * ratio.width / ratio.height) / 16) * 16, height: shortSide }
        : { width: shortSide, height: Math.round((shortSide * ratio.height / ratio.width) / 16) * 16 };
}

async function uploadReferences(references: ReferenceImage[], scopeId: string, options?: PlatformRequestOptions) {
    const assetIds: string[] = [];
    for (const reference of references) {
        checkScope(scopeId, options?.signal);
        // Parent asset URLs are already authenticated durable references. Reuse them
        // rather than uploading a second copy of a generated image.
        const durable = /^\/api\/assets\/([^/]+)\/content$/.exec(reference.dataUrl || reference.url || "");
        if (durable && getPlatformInit()?.assets.some((asset) => asset.id === durable[1])) { assetIds.push(durable[1]); continue; }
        const dataUrl = await imageToDataUrl(reference);
        checkScope(scopeId, options?.signal);
        if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl)) throw new Error("生成参考图仅支持 PNG、JPEG 或 WebP");
        if (dataUrl.length > Math.ceil(4 * 1024 * 1024 * 4 / 3) + 100) throw new Error("每张生成参考图不能超过 4 MiB");
        const uploaded = await platformRequest<PlatformAsset>("assets.upload", { name: reference.name || "reference.png", mimeType: reference.type || dataUrl.slice(5, dataUrl.indexOf(";")), dataUrl }, options);
        checkScope(scopeId, options?.signal);
        if (!uploaded?.id) throw new Error("参考图上传未返回素材标识，尚未提交生成任务");
        assetIds.push(uploaded.id);
    }
    return assetIds;
}

export async function createPlatformGeneration(config: AiConfig, kind: "image" | "video", prompt: string, references: ReferenceImage[] = [], options?: PlatformRequestOptions): Promise<PlatformGenerationTask> {
    if (kind === "video" && (config.videoSkillReviewRequired || (!config.videoSkillId && config.appliedSkillId))) throw new Error("请先在视频 Skill 处确认旧配置中的镜头文字，原文会完整保留");
    const init = await waitForPlatformInit(options);
    checkScope(init.scopeId, options?.signal);
    const model = rawModel(config.model || (kind === "video" ? config.videoModel : config.imageModel));
    const declared = init.models[kind].find((item) => item.id === model);
    if (!declared?.available) throw new Error("所选平台生成通道当前不可用，请在工作台检查本机账号池");
    if (references.length && declared.caps?.supportsReferenceImages === false)
        throw new Error("此渠道仅支持文字生成，请移除参考图或改用支持参考图的模型");
    validateSupportedOptions(config, kind, references.length);
    const modes = Array.isArray(declared.caps?.supportedVideoModes) ? declared.caps.supportedVideoModes : ["auto", "reference"];
    if (kind === "video" && !modes.includes(config.videoMode || "auto")) throw new Error("当前视频模型不支持首尾帧，请选择支持首尾帧的 Muse 服务通道或使用全能参考模式");
    const configuredMaximum = Number(declared.caps?.maxReferenceImages);
    const maximumReferences = kind === "video" && config.videoMode === "frames" ? Math.min(2, configuredMaximum || 1) : Number.isInteger(configuredMaximum) ? configuredMaximum : kind === "video" ? 1 : 4;
    if (references.length > maximumReferences) throw new Error(`当前${kind === "video" ? "视频" : "图片"}生成最多支持 ${maximumReferences} 张参考图`);
    if (kind === "video" && config.videoMode === "frames" && references.length === 0) throw new Error("首尾帧模式请先连接首帧图片，可再连接一张尾帧");
    if (!prompt.trim()) throw new Error("请先输入生成提示词");
    let preparedPrompt = prompt.trim();
    if (kind === "video" && config.videoSkillId) {
        const prepared = await platformRequest<{ prompt: string; skillId: string; skillVersion: string }>("skills.prompt", {
            id: config.videoSkillId, version: config.videoSkillVersion, text: preparedPrompt, referenceCount: references.length,
        }, options);
        checkScope(init.scopeId, options?.signal);
        if (prepared.skillId !== config.videoSkillId || prepared.skillVersion !== config.videoSkillVersion || typeof prepared.prompt !== "string" || !prepared.prompt.trim()) throw new Error("视频 Skill 返回无效，请重新选择");
        preparedPrompt = prepared.prompt;
    }
    const text = config.systemPrompt?.trim() ? `${config.systemPrompt.trim()}\n\n${preparedPrompt}` : preparedPrompt;
    if (text.length > 12000) throw new Error("生成提示词不能超过 12000 字符");
    const { width, height } = dimensions(config, kind);
    if (![width, height].every((value) => Number.isInteger(value) && value >= 64 && value <= 4096)) throw new Error("平台生成宽高应在 64–4096 像素之间");
    const duration = kind === "video" ? Number(config.videoSeconds || 6) : 5;
    if (!Number.isInteger(duration) || duration < 2 || duration > 20) throw new Error("当前平台视频时长支持 2–20 秒，请调整生成配置");
    const orderedReferences = kind === "video" && config.videoMode === "frames" && config.videoFramesReversed ? [...references].reverse() : references;
    const referenceAssetIds = await uploadReferences(orderedReferences, init.scopeId, options);
    checkScope(init.scopeId, options?.signal);
    const idempotencyKey = crypto.randomUUID();
    const job = await platformRequest<PlatformJob>("jobs.create", {
        projectId: init.project.id, nodeId: `engine-${idempotencyKey}`, kind, prompt: text, model, width, height, duration, referenceAssetIds, idempotencyKey,
        ...(kind === "video" ? { videoMode: config.videoMode || "auto" } : {}),
        ...(kind === "video" && config.videoSkillId ? { skillId: config.videoSkillId, skillVersion: config.videoSkillVersion } : config.appliedSkillId ? { skillId: config.appliedSkillId, skillVersion: config.appliedSkillVersion } : {}),
    }, options);
    if (!job?.id || job.projectId !== init.project.id || job.kind !== kind) throw new Error("平台返回了不匹配的生成任务；请核对任务列表，不要重复提交");
    const task = { id: job.id, model, scopeId: init.scopeId, projectId: init.project.id };
    if (options?.signal?.aborted) { void cancelPlatformGeneration(task); throw platformAbortError(); }
    return task;
}

export async function getPlatformGeneration(task: PlatformGenerationTask, options?: PlatformRequestOptions): Promise<PlatformJob> {
    checkScope(task.scopeId, options?.signal);
    const job = await platformRequest<PlatformJob>("jobs.status", { id: task.id }, options);
    checkScope(task.scopeId, options?.signal);
    if (job?.id !== task.id || job.projectId !== task.projectId) throw new Error("平台任务不属于当前画布，已停止本地追踪");
    return job;
}

export async function cancelPlatformGeneration(task: PlatformGenerationTask) {
    if (getPlatformInit()?.scopeId !== task.scopeId) return;
    try { await platformRequest("jobs.cancel", { id: task.id }, { timeoutMs: 15_000 }); } catch { /* Never replace an abort with a second submit or a fabricated result. */ }
}

export function generationFailure(job: PlatformJob) {
    if (job.status === "unknown_external") return job.error || "外部生成状态未确认，请核对工作台任务列表；系统不会自动重复提交";
    if (job.status === "cancelled") return job.error || "生成已取消；供应商已提交的任务可能仍会继续";
    return job.error || "生成失败，请检查工作台任务详情";
}

export async function waitForPlatformGeneration(task: PlatformGenerationTask, options?: PlatformRequestOptions) {
    if (options?.signal?.aborted) { void cancelPlatformGeneration(task); throw platformAbortError(); }
    const onAbort = () => { void cancelPlatformGeneration(task); };
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    try {
        const deadline = Date.now() + 2 * 60 * 60 * 1000;
        while (Date.now() < deadline) {
            const job = await getPlatformGeneration(task, options);
            if (job.status === "succeeded") {
                if (!job.resultUrl || !/^\/api\/assets\/[^/]+\/content$/.test(job.resultUrl)) throw new Error("平台任务已完成，但尚未返回有效素材，请在任务列表检查");
                return job;
            }
            if (terminalFailures.has(job.status)) throw new Error(generationFailure(job));
            await abortableDelay(2000, options?.signal);
        }
        throw new Error("任务已超过两小时追踪上限，请在工作台核对上游状态；系统不会自动重新生成");
    } finally { options?.signal?.removeEventListener("abort", onAbort); }
}

export function abortableDelay(milliseconds: number, signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(platformAbortError());
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener("abort", aborted);
        const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
        const aborted = () => { clearTimeout(timer); cleanup(); reject(platformAbortError()); };
        signal?.addEventListener("abort", aborted, { once: true });
    });
}

export async function generatePlatformImages(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: PlatformRequestOptions) {
    const count = Number(config.count || 1);
    if (!Number.isInteger(count) || count < 1 || count > 15) throw new Error("每次图片生成数量应为 1–15 的整数");
    const results: Array<{ id: string; dataUrl: string }> = [];
    // The platform returns one result per durable job. Each requested result is an
    // explicit independent submission; no automatic replay occurs after an error.
    for (let index = 0; index < count; index += 1) {
        const task = await createPlatformGeneration(config, "image", prompt, references, options);
        const job = await waitForPlatformGeneration(task, options);
        results.push({ id: job.resultAssetId || job.id, dataUrl: job.resultUrl! });
    }
    return results;
}
