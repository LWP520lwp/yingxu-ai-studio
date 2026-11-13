import {
  generateAtlasImageBatch,
  type AtlasImageBatchPorts,
} from "@/atlas-engine/workflows/image-generation";
import {
  generateAtlasTextBatch,
  type AtlasTextBatchPorts,
} from "@/atlas-engine/workflows/text-generation";
import {
  generateAtlasAudio,
  type AtlasAudioGenerationPorts,
} from "@/atlas-engine/workflows/audio-generation";
import {
  summarizeAtlasGenerationBatch,
  type AtlasGenerationBatchSummary,
} from "@/atlas-engine/workflows/generation-batch";
import { atlasTextBatchOutcome } from "@/atlas-engine/workflows/generation-state";
import { buildAtlasAudioGenerationMetadata } from "@/atlas-engine/model/node-factory";
import { buildNodeResponseMessages, type NodeGenerationContext } from "@/atlas-engine/workflows/node-generation-context";
import type { AtlasNodeOutputPlan } from "@/atlas-engine/workflows/node-output";
import type { AtlasGenerationEvent } from "@/atlas-engine/workflows/generation-events";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeText } from "@/types/canvas";
import { throwIfAborted } from "@/services/media-storage-runtime";

type AtlasVideoExecution = Readonly<{
  outputId: string;
  config: AiConfig;
  prompt: string;
  context: NodeGenerationContext;
  signal: AbortSignal;
}>;

export type AtlasProviderPorts = Readonly<{
  image: AtlasImageBatchPorts;
  text: AtlasTextBatchPorts;
  audio: AtlasAudioGenerationPorts;
  video: (input: AtlasVideoExecution) => Promise<void>;
}>;

export type AtlasProviderResult =
  | Readonly<{ kind: "images"; summary: AtlasGenerationBatchSummary; firstError: string }>
  | Readonly<{ kind: "texts"; completed: CanvasNodeText[]; failed: CanvasNodeText[] }>
  | Readonly<{ kind: "media"; mode: "video" | "audio" }>;

export type AtlasProviderExecution = Readonly<{
  plan: AtlasNodeOutputPlan;
  config: AiConfig;
  context: NodeGenerationContext;
  signal: AbortSignal;
  ports: AtlasProviderPorts;
  emit: (event: AtlasGenerationEvent) => void;
  errorText: (error: unknown) => string;
}>;

/** Runs provider I/O and publishes typed result events without owning UI state. */
export async function executeAtlasProvider(
  run: AtlasProviderExecution,
): Promise<AtlasProviderResult> {
  const { plan, context, config, signal, emit, ports } = run;
  throwIfAborted(signal);
  const prompt = context.prompt.trim();

  switch (plan.mode) {
    case "image": {
      let firstError = "";
      const results = await generateAtlasImageBatch({
        imageIds: plan.output.imageIds,
        config,
        prompt,
        references: plan.output.references.map((reference) => ({ ...reference })),
        signal,
        ports: ports.image,
        onImage: (variantId, image) => emit({ type: "image-stored", variantId, image }),
        onFailure: (variantId, error) => {
          const details = run.errorText(error);
          firstError ||= details;
          emit({ type: "image-failed", variantId, details });
        },
      });
      return {
        kind: "images",
        summary: summarizeAtlasGenerationBatch(results.map((result) => result.outcome)),
        firstError,
      };
    }
    case "text": {
      const results = await generateAtlasTextBatch({
        textIds: plan.output.resultIds,
        config,
        messages: buildNodeResponseMessages({ ...context, prompt }),
        signal,
        ports: ports.text,
        onStream: (variantId, content) => emit({ type: "text-patch", variantId, patch: { content } }),
        onSuccess: (variantId, content) => emit({ type: "text-patch", variantId, patch: { content, status: "success" } }),
        onFailure: (variantId, error) => {
          const errorDetails = run.errorText(error);
          emit({ type: "text-patch", variantId, patch: { status: "error", errorDetails } });
          return errorDetails;
        },
      });
      return { kind: "texts", ...atlasTextBatchOutcome(results) };
    }
    case "audio":
      await generateAtlasAudio({
        config,
        prompt,
        signal,
        ports: ports.audio,
        onAudio: (audio) => emit({
          type: "audio-stored",
          audio,
          metadata: { prompt, ...buildAtlasAudioGenerationMetadata(config) },
        }),
      });
      return { kind: "media", mode: "audio" };
    case "video":
      await ports.video({ outputId: plan.output.outputId, config, prompt, context, signal });
      return { kind: "media", mode: "video" };
  }
}

/** Writes a single image back into a plugin's own node without creating batch variants. */
export async function executeAtlasImageWriteback(input: Readonly<{
  config: AiConfig;
  context: NodeGenerationContext;
  signal: AbortSignal;
  ports: AtlasImageBatchPorts;
}>) {
  const { context, signal, ports } = input;
  const config = { ...input.config, count: "1" };
  throwIfAborted(signal);
  const images = context.referenceImages.length
    ? await ports.edit(config, context.prompt, context.referenceImages, { signal })
    : await ports.generate(config, context.prompt, { signal });
  throwIfAborted(signal);
  if (!images[0]?.dataUrl) throw new Error("Image provider returned no image");
  const uploaded = await ports.upload(images[0].dataUrl, { signal });
  throwIfAborted(signal);
  return uploaded;
}
