import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedFile } from "@/services/file-storage";
import { throwIfAborted } from "@/services/media-storage-runtime";
import type {
  requestAudioGeneration,
  storeGeneratedAudio,
} from "@/services/api/audio";

export type CanvasAudioGenerationPorts = {
  generate: typeof requestAudioGeneration;
  store: typeof storeGeneratedAudio;
};

export type CanvasAudioGenerationArgs = {
  config: AiConfig;
  prompt: string;
  signal: AbortSignal;
  ports: CanvasAudioGenerationPorts;
  onAudio: (audio: UploadedFile) => void;
};

export async function generateCanvasAudio({
  config,
  prompt,
  signal,
  ports,
  onAudio,
}: CanvasAudioGenerationArgs): Promise<void> {
  throwIfAborted(signal);
  const result = await ports.generate(config, prompt, { signal });
  throwIfAborted(signal);
  const audio = await ports.store(result, config.audioFormat);
  throwIfAborted(signal);
  onAudio(audio);
}
