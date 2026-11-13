import { atlasNodeSizeFromRatio } from "@/atlas-engine/model/node-size";
import type { AiConfig } from "@/stores/use-config-store";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type CanvasNodeText,
  type Position,
} from "@/types/canvas";

const NODE_SIZE = {
  audio: { width: 340, height: 120 },
  config: { width: 340, height: 240 },
  text: { width: 340, height: 240 },
  video: { width: 420, height: 236 },
} as const;

export type AtlasGeneratedOutputKind = "audio" | "text" | "video";

export type AtlasGeneratedOutputPlan = Readonly<{
  kind: AtlasGeneratedOutputKind;
  sourceId: string;
  outputId: string;
  outputNode: CanvasNodeData;
  resultIds: readonly string[];
  reusesSource: boolean;
  configurationSource: boolean;
  sourceStatus?: "loading" | "success";
  connection?: CanvasConnection;
}>;

export type AtlasGeneratedOutputInput = Readonly<{
  kind: AtlasGeneratedOutputKind;
  sourceId: string;
  sourceNode?: CanvasNodeData;
  prompt: string;
  config: AiConfig;
  overwriteExisting: boolean;
  createId: () => string;
  textCount?: number;
  references?: readonly string[];
}>;

function validCount(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(15, Math.floor(value!)))
    : 1;
}

function originOf(node: CanvasNodeData | undefined): Position {
  return node?.position ?? { x: 0, y: 0 };
}

function outputPosition(
  source: CanvasNodeData | undefined,
  parentSize: Readonly<{ width: number; height: number }>,
  childSize: Readonly<{ width: number; height: number }>,
): Position {
  const origin = originOf(source);
  return {
    x: origin.x + (source?.width || parentSize.width) + 96,
    y:
      origin.y + ((source?.height || parentSize.height) - childSize.height) / 2,
  };
}

function makePlan(
  input: AtlasGeneratedOutputInput,
  outputNode: CanvasNodeData,
  resultIds: string[],
  reusesSource: boolean,
  sourceStatus: "loading" | "success" | undefined,
): AtlasGeneratedOutputPlan {
  const connection = reusesSource
    ? undefined
    : {
        id: input.createId(),
        fromNodeId: input.sourceId,
        toNodeId: outputNode.id,
      };
  return {
    kind: input.kind,
    sourceId: input.sourceId,
    outputId: outputNode.id,
    outputNode,
    resultIds,
    reusesSource,
    configurationSource: input.sourceNode?.type === CanvasNodeType.Config,
    ...(sourceStatus ? { sourceStatus } : {}),
    ...(connection ? { connection } : {}),
  };
}

export function planAtlasGeneratedOutput(
  input: AtlasGeneratedOutputInput,
): AtlasGeneratedOutputPlan {
  const source = input.sourceNode;
  const origin = originOf(source);
  const title = input.prompt.slice(0, 32);

  if (input.kind === "video") {
    const requestedSize =
      atlasNodeSizeFromRatio(
        input.config.size,
        NODE_SIZE.video.width,
        NODE_SIZE.video.height,
      ) ?? NODE_SIZE.video;
    const emptySource =
      source?.type === CanvasNodeType.Video && !source.metadata?.content;
    const reusesSource =
      source?.type === CanvasNodeType.Video &&
      (input.overwriteExisting || emptySource);
    const outputId = reusesSource ? input.sourceId : input.createId();
    const size = reusesSource
      ? { width: source.width, height: source.height }
      : requestedSize;
    const outputNode: CanvasNodeData = {
      id: outputId,
      type: CanvasNodeType.Video,
      title: title || "Generated Video",
      position: reusesSource
        ? { ...source.position }
        : {
            x: origin.x + (source?.width || NODE_SIZE.video.width) + 96,
            y: origin.y,
          },
      ...size,
      metadata: {
        prompt: input.prompt,
        status: "loading",
        model: input.config.model,
        size: input.config.size,
        seconds: input.config.videoSeconds,
        vquality: input.config.vquality,
        generateAudio: input.config.videoGenerateAudio,
        watermark: input.config.videoWatermark,
        videoMode: input.config.videoMode,
        references: [...(input.references ?? [])],
      },
    };
    return makePlan(
      input,
      outputNode,
      [],
      Boolean(reusesSource),
      reusesSource ? undefined : "success",
    );
  }

  if (input.kind === "audio") {
    const emptySource =
      source?.type === CanvasNodeType.Audio && !source.metadata?.content;
    const reusesSource =
      source?.type === CanvasNodeType.Audio &&
      (input.overwriteExisting || emptySource);
    const outputId = reusesSource ? input.sourceId : input.createId();
    const size = reusesSource
      ? { width: source.width, height: source.height }
      : NODE_SIZE.audio;
    const outputNode: CanvasNodeData = {
      id: outputId,
      type: CanvasNodeType.Audio,
      title: title || "Generated Audio",
      position: reusesSource
        ? { ...source.position }
        : outputPosition(source, NODE_SIZE.audio, size),
      ...size,
      metadata: {
        prompt: input.prompt,
        status: "loading",
        model: input.config.model,
        audioVoice: input.config.audioVoice,
        audioFormat: input.config.audioFormat,
        audioSpeed: input.config.audioSpeed,
        audioInstructions: input.config.audioInstructions,
      },
    };
    return makePlan(
      input,
      outputNode,
      [],
      Boolean(reusesSource),
      reusesSource ? undefined : "success",
    );
  }

  const textCount = validCount(input.textCount);
  const emptySource =
    source?.type === CanvasNodeType.Text && !source.metadata?.content;
  const reusesSource =
    source?.type === CanvasNodeType.Text &&
    (input.overwriteExisting || emptySource);
  const outputId = reusesSource ? input.sourceId : input.createId();
  const resultIds = Array.from({ length: textCount }, () => input.createId());
  const parentSize =
    source?.type === CanvasNodeType.Config ? NODE_SIZE.config : NODE_SIZE.text;
  const size = reusesSource
    ? { width: source.width, height: source.height }
    : NODE_SIZE.text;
  const texts: CanvasNodeText[] = resultIds.map((id) => ({
    id,
    status: "loading",
    content: "",
  }));
  const outputNode: CanvasNodeData = {
    id: outputId,
    type: CanvasNodeType.Text,
    title: title || "Generated Text",
    position: reusesSource
      ? { ...source.position }
      : {
          x: origin.x + parentSize.width + 96,
          y: origin.y + parentSize.height / 2 - size.height / 2,
        },
    ...size,
    metadata: {
      prompt: input.prompt,
      status: "loading",
      fontSize: 14,
      model: input.config.model,
      reasoningEffort: input.config.reasoningEffort,
      textCount,
      texts,
      primaryTextId: resultIds[0],
    },
  };
  return makePlan(
    input,
    outputNode,
    resultIds,
    Boolean(reusesSource),
    input.sourceNode?.type === CanvasNodeType.Config && !reusesSource
      ? "loading"
      : undefined,
  );
}

export function applyAtlasGeneratedOutputPlan(
  nodes: readonly CanvasNodeData[],
  plan: AtlasGeneratedOutputPlan,
): CanvasNodeData[] {
  if (plan.reusesSource) {
    return nodes.map((node) =>
      node.id === plan.sourceId ? { ...node, ...plan.outputNode } : node,
    );
  }

  const next = nodes.map((node) => {
    if (node.id !== plan.sourceId || !plan.sourceStatus) return node;
    return {
      ...node,
      metadata: {
        ...node.metadata,
        status: plan.sourceStatus,
        ...(plan.sourceStatus === "loading" ? { errorDetails: undefined } : {}),
      },
    };
  });
  return [...next, plan.outputNode];
}
