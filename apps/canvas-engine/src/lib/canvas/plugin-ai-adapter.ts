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
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { imageToDataUrl } from "@/services/image-storage";
import {
  decodeChannelModel,
  selectableModelsByCapability,
  type AiConfig,
  type ModelCapability,
} from "@/stores/use-config-store";
import type { CanvasPluginAi } from "@/types/canvas-plugin";
import type { ReferenceImage } from "@/types/image";

export type PluginAiReadinessCheck = (config: AiConfig) => void;

export function createCanvasPluginAiAdapter(
  effectiveConfig: AiConfig,
  ensureReady: PluginAiReadinessCheck,
): CanvasPluginAi {
  return {
    generateImage: async (prompt, options) => {
      const config = {
        ...buildGenerationConfig(effectiveConfig, undefined, "image"),
        count: String(options?.count || 1),
        ...(options?.model ? { model: options.model } : {}),
        ...(options?.size ? { size: options.size } : {}),
      };
      ensureReady(config);
      const references = pluginReferences(options?.references);
      const items = references.length
        ? await requestEdit(config, prompt, references, {
            signal: options?.signal,
          })
        : await requestGeneration(config, prompt, { signal: options?.signal });
      const images = await Promise.all(
        items.map((item) => restoreImageDataUrl(item.dataUrl, options?.signal)),
      );
      return { images };
    },
    generateVideo: async (prompt, options) => {
      const config = {
        ...buildGenerationConfig(effectiveConfig, undefined, "video"),
        ...(options?.model ? { model: options.model } : {}),
        ...(options?.size ? { size: options.size } : {}),
        ...(options?.seconds ? { videoSeconds: options.seconds } : {}),
      };
      ensureReady(config);
      const result = await requestVideoGeneration(
        config,
        prompt,
        pluginReferences(options?.references),
        { signal: options?.signal },
      );
      const file = await storeGeneratedVideo(result);
      return {
        url: file.url,
        mimeType: file.mimeType,
        width: file.width,
        height: file.height,
        durationMs: file.durationMs,
      };
    },
    generateText: async (prompt, options) => {
      const config = {
        ...buildGenerationConfig(effectiveConfig, undefined, "text"),
        ...(options?.model ? { model: options.model } : {}),
      };
      ensureReady(config);
      const messages: AiTextMessage[] = pluginTextMessages(
        prompt,
        options?.system,
      );
      const text = await requestImageQuestion(
        config,
        messages,
        (delta) => options?.onDelta?.(delta),
        { signal: options?.signal },
      );
      return { text };
    },
    listModels: (capability) =>
      selectableModelsByCapability(
        effectiveConfig,
        capability as ModelCapability | undefined,
      ).map((value) => ({
        value,
        label: decodeChannelModel(value)?.model || value,
      })),
    defaultModel: (capability) =>
      buildGenerationConfig(effectiveConfig, undefined, capability).model,
  };
}

export function pluginReferences(
  references?: readonly string[],
): ReferenceImage[] {
  return (references || []).filter(Boolean).map((dataUrl, index) => ({
    id: `plugin-ref-${index}`,
    name: `ref-${index}.png`,
    type: "image/png",
    dataUrl,
  }));
}

export function pluginTextMessages(
  prompt: string,
  system?: string,
): AiTextMessage[] {
  return [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user", content: prompt },
  ];
}

async function restoreImageDataUrl(dataUrl: string, signal?: AbortSignal) {
  try {
    return await imageToDataUrl({ dataUrl }, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return dataUrl;
  }
}
