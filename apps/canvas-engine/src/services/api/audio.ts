import type { AiConfig } from "@/stores/use-config-store";
import { audioMimeType } from "@/lib/audio-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { unsupportedGeneration } from "@/platform/generation";

type RequestOptions = { signal?: AbortSignal };

/** Audio generation is intentionally delegated to provider capabilities exposed by the workbench. */
export async function requestAudioGeneration(_config: AiConfig, _prompt: string, _options?: RequestOptions): Promise<Blob> {
    return await unsupportedGeneration("audio");
}

/** Normalize provider output before it enters the shared asset store. */
export function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const normalized = blob.type.startsWith("audio/")
        ? blob
        : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(normalized, "audio");
}
