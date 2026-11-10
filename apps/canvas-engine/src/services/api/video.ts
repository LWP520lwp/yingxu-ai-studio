import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { cancelPlatformGeneration, createPlatformGeneration, generationFailure, getPlatformGeneration, waitForPlatformGeneration, type PlatformGenerationTask } from "@/platform/generation";
import { getPlatformInit, platformAbortError, platformRequest, type PlatformAsset } from "@/platform/rpc";

type RequestOptions = { signal?: AbortSignal };
type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini" | "plugin" | "platform"; model: string; scopeId?: string; projectId?: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

function platformTask(task: VideoGenerationTask): PlatformGenerationTask {
    const init = getPlatformInit();
    if (!init) throw new Error("平台画布尚未初始化");
    return { id: task.id, model: task.model, scopeId: task.scopeId || init.scopeId, projectId: task.projectId || init.project.id };
}

function videoTaskFailed(message: string) { const error = new Error(message); error.name = "VideoTaskFailed"; return error; }
export function isVideoTaskFailed(error: unknown) { return error instanceof Error && error.name === "VideoTaskFailed"; }

async function videoResult(url: string, assetId?: string | null, options?: RequestOptions): Promise<VideoGenerationResult> {
    if (options?.signal?.aborted) throw platformAbortError();
    const assets = await platformRequest<PlatformAsset[]>("assets.list", {}, options);
    if (options?.signal?.aborted) throw platformAbortError();
    const asset = assets.find((item) => item.id === assetId);
    if (!asset?.mimeType?.startsWith("video/")) throw new Error("平台视频素材元数据尚未确认，请在任务列表核对素材；系统不会重复提交生成");
    return { url, mimeType: asset.mimeType };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask & { provider: "platform" }> {
    if (options?.videos?.length || options?.audios?.length) throw new Error("当前平台视频生成仅支持文字和单张参考图，暂不支持视频或音频参考素材");
    return { ...await createPlatformGeneration(config, "video", prompt, references, options), provider: "platform" };
}

export async function pollVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const scopedTask = platformTask(task);
    if (options?.signal?.aborted) { void cancelPlatformGeneration(scopedTask); throw platformAbortError(); }
    const onAbort = () => { void cancelPlatformGeneration(scopedTask); };
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    let job;
    try { job = await getPlatformGeneration(scopedTask, options); }
    finally { options?.signal?.removeEventListener("abort", onAbort); }
    if (job.status === "succeeded") {
        if (!job.resultUrl || !/^\/api\/assets\/[^/]+\/content$/.test(job.resultUrl)) return { status: "failed", error: "任务已完成，但未返回有效视频素材，请核对工作台任务列表" };
        return { status: "completed", result: await videoResult(job.resultUrl, job.resultAssetId, options) };
    }
    if (["failed", "cancelled", "unknown_external"].includes(job.status)) return { status: "failed", error: generationFailure(job) };
    return { status: "pending" };
}

export async function waitForVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const job = await waitForPlatformGeneration(platformTask(task), options);
        return videoResult(job.resultUrl!, job.resultAssetId, options);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw videoTaskFailed(error instanceof Error ? error.message : "视频任务状态未确认，请核对工作台任务列表");
    }
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.url && /^\/api\/assets\/[^/]+\/content$/.test(result.url)) {
        if (!result.mimeType?.startsWith("video/")) throw new Error("尚未确认视频素材格式，请在任务列表核对素材");
        return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType };
    }
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) return uploadMediaFile(result.url, "video");
    throw new Error("未获得可播放的视频素材");
}
