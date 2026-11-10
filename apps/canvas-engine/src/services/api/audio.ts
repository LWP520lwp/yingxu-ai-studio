import type { AiConfig } from "@/stores/use-config-store";
import { audioMimeType } from "@/lib/audio-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { unsupportedGeneration } from "@/platform/generation";

type RequestOptions = { signal?: AbortSignal };

export async function requestAudioGeneration(_config: AiConfig, _prompt: string, _options?: RequestOptions): Promise<Blob> {
    return unsupportedGeneration("audio");
}

/** Upload/playback remain usable independently of the unavailable audio-generation capability. */
export function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}
