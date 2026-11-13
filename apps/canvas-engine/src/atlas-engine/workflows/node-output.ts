import type { AtlasImageOutputPlan } from "@/atlas-engine/workflows/generation-output";
import {
  applyAtlasGeneratedOutputPlan,
  planAtlasGeneratedOutput,
  type AtlasGeneratedOutputPlan,
} from "@/atlas-engine/host/workflows/generated-output-plan";
import {
  applyAtlasImageOutputPlan,
  planAtlasImageOutput,
} from "@/atlas-engine/workflows/generation-output";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type {
  CanvasGenerationMode,
  CanvasNodeData,
} from "@/types/canvas";

export type AtlasNodeOutputPlan =
  | Readonly<{ mode: "image"; output: AtlasImageOutputPlan }>
  | Readonly<{
      mode: "video" | "audio" | "text";
      output: AtlasGeneratedOutputPlan;
    }>;

export type AtlasNodeOutputInput = Readonly<{
  mode: CanvasGenerationMode;
  sourceId: string;
  sourceNode?: CanvasNodeData;
  prompt: string;
  sourcePrompt: string;
  config: AiConfig;
  overwriteExisting: boolean;
  imageCount: number;
  textCount: number;
  references: readonly ReferenceImage[];
  referenceUrls: readonly string[];
  createId: () => string;
}>;

export function planAtlasNodeOutput(
  input: AtlasNodeOutputInput,
): AtlasNodeOutputPlan {
  if (input.mode === "image") {
    return {
      mode: "image",
      output: planAtlasImageOutput({
        sourceId: input.sourceId,
        sourceNode: input.sourceNode,
        prompt: input.prompt,
        sourcePrompt: input.sourcePrompt,
        config: input.config,
        overwriteExisting: input.overwriteExisting,
        count: input.imageCount,
        references: input.references,
        createId: input.createId,
      }),
    };
  }

  return {
    mode: input.mode,
    output: planAtlasGeneratedOutput({
      kind: input.mode,
      sourceId: input.sourceId,
      sourceNode: input.sourceNode,
      prompt: input.prompt,
      config: input.config,
      overwriteExisting: input.overwriteExisting,
      textCount: input.textCount,
      references: input.referenceUrls,
      createId: input.createId,
    }),
  };
}

export function atlasNodeOutputId(plan: AtlasNodeOutputPlan) {
  return plan.output.outputId;
}

export function atlasNodeOutputConnection(plan: AtlasNodeOutputPlan) {
  return plan.output.connection;
}

export function atlasNodeOutputResultIds(
  plan: AtlasNodeOutputPlan,
): readonly string[] {
  return plan.mode === "image"
    ? plan.output.imageIds
    : plan.output.resultIds;
}

export function applyAtlasNodeOutputPlan(
  nodes: readonly CanvasNodeData[],
  plan: AtlasNodeOutputPlan,
): CanvasNodeData[] {
  return plan.mode === "image"
    ? applyAtlasImageOutputPlan(nodes, plan.output)
    : applyAtlasGeneratedOutputPlan(nodes, plan.output);
}
