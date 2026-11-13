import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedFile } from "@/services/file-storage";
import { throwIfAborted } from "@/services/media-storage-runtime";
import type {
  requestAudioGeneration,
  storeGeneratedAudio,
} from "@/services/api/audio";

export type AtlasAudioGenerationPorts = {
  generate: typeof requestAudioGeneration;
  store: typeof storeGeneratedAudio;
};

export type AtlasAudioGenerationArgs = {
  config: AiConfig;
  prompt: string;
  signal: AbortSignal;
  ports: AtlasAudioGenerationPorts;
  onAudio: (audio: UploadedFile) => void;
};

export async function generateAtlasAudio({
  config,
  prompt,
  signal,
  ports,
  onAudio,
}: AtlasAudioGenerationArgs): Promise<void> {
  throwIfAborted(signal);
  const result = await ports.generate(config, prompt, { signal });
  throwIfAborted(signal);
  const audio = await ports.store(result, config.audioFormat);
  throwIfAborted(signal);
  onAudio(audio);
}
