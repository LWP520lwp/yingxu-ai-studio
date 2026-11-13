import type { AiTextMessage } from "@/services/api/image";
import {
  requestEdit,
  requestGeneration,
  requestImageQuestion,
} from "@/services/api/image";
import {
  requestVideoGeneration,
  storeGeneratedVideo,
} from "@/services/api/video";
import { buildAtlasGenerationConfig } from "@/atlas-engine/workflows/generation-runtime";
import { imageToDataUrl } from "@/services/image-storage";
import {
  decodeChannelModel,
  selectableModelsByCapability,
  type AiConfig,
  type ModelCapability,
} from "@/stores/use-config-store";
import type { CanvasPluginAi } from "@/types/canvas-plugin";
import type { ReferenceImage } from "@/types/image";

export type AtlasPluginReadinessCheck = (config: AiConfig) => void;

export function createAtlasPluginGeneration(
  effectiveConfig: AiConfig,
  ensureReady: AtlasPluginReadinessCheck,
): CanvasPluginAi {
  return {
    generateImage: async (prompt, options) => {
      const config = {
        ...buildAtlasGenerationConfig(effectiveConfig, undefined, "image"),
        count: String(options?.count || 1),
        ...(options?.model ? { model: options.model } : {}),
        ...(options?.size ? { size: options.size } : {}),
      };
      ensureReady(config);
      const references = toReferences(options?.references);
      const items = references.length
        ? await requestEdit(config, prompt, references, { signal: options?.signal })
        : await requestGeneration(config, prompt, { signal: options?.signal });
      const images = await Promise.all(
        items.map((item) => normalizeImage(item.dataUrl, options?.signal)),
      );
      return { images };
    },
    generateVideo: async (prompt, options) => {
      const config = {
        ...buildAtlasGenerationConfig(effectiveConfig, undefined, "video"),
        ...(options?.model ? { model: options.model } : {}),
        ...(options?.size ? { size: options.size } : {}),
        ...(options?.seconds ? { videoSeconds: options.seconds } : {}),
      };
      ensureReady(config);
      const generated = await requestVideoGeneration(
        config,
        prompt,
        toReferences(options?.references),
        { signal: options?.signal },
      );
      const video = await storeGeneratedVideo(generated);
      return {
        url: video.url,
        mimeType: video.mimeType,
        width: video.width,
        height: video.height,
        durationMs: video.durationMs,
      };
    },
    generateText: async (prompt, options) => {
      const config = {
        ...buildAtlasGenerationConfig(effectiveConfig, undefined, "text"),
        ...(options?.model ? { model: options.model } : {}),
      };
      ensureReady(config);
      const messages = toMessages(prompt, options?.system);
      const text = await requestImageQuestion(
        config,
        messages,
        (delta) => options?.onDelta?.(delta),
        { signal: options?.signal },
      );
      return { text };
    },
    listModels: (capability) =>
      selectableModelsByCapability(effectiveConfig, capability as ModelCapability | undefined)
        .map((value) => ({ value, label: decodeChannelModel(value)?.model || value })),
    defaultModel: (capability) =>
      buildAtlasGenerationConfig(effectiveConfig, undefined, capability).model,
  };
}

export function toReferences(values?: readonly string[]): ReferenceImage[] {
  return (values ?? []).filter(Boolean).map((dataUrl, index) => ({
    id: `plugin-ref-${index}`,
    name: `ref-${index}.png`,
    type: "image/png",
    dataUrl,
  }));
}

export function toMessages(prompt: string, system?: string): AiTextMessage[] {
  return [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user", content: prompt },
  ];
}

async function normalizeImage(dataUrl: string, signal?: AbortSignal) {
  try {
    return await imageToDataUrl({ dataUrl }, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return dataUrl;
  }
}
