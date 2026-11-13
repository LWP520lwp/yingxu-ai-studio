import { nanoid } from "nanoid";

import { getNodeSpec } from "@/constant/canvas";
import { createAtlasNode } from "@/atlas-engine/model/node-factory";
import { atlasGenerationCount } from "@/atlas-engine/workflows/generation-runtime";
import type { AtlasCommand } from "@/atlas-engine/reducer";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { planAtlasNodeInsertion } from "./node-commands";

export type AtlasGenerationPlacement = Readonly<{
  commands: readonly AtlasCommand[];
  panelId: string;
}>;

function placeParameterNode(source: CanvasNodeData, metadata: CanvasNodeMetadata) {
  const spec = getNodeSpec(CanvasNodeType.Config);
  const node = createAtlasNode(CanvasNodeType.Config, { x: 0, y: 0 }, metadata);
  node.position = {
    x: source.position.x + source.width + 96,
    y: source.position.y + (source.height - node.height) / 2,
  };
  node.width = spec.width;
  return node;
}

function connectedPlacement(sourceId: string, output: CanvasNodeData): AtlasGenerationPlacement {
  return {
    panelId: output.id,
    commands: planAtlasNodeInsertion([output], [
      { id: nanoid(), fromNodeId: sourceId, toNodeId: output.id },
    ]),
  };
}

/** Captures the latest text and creates its image configuration in one transaction. */
export function planAtlasTextToImage(
  source: CanvasNodeData | undefined,
  config: AiConfig,
): AtlasGenerationPlacement | null {
  if (source?.type !== CanvasNodeType.Text) return null;
  const prompt = (source.metadata?.content || source.metadata?.prompt || "").trim();
  if (!prompt) return null;
  const output = placeParameterNode(source, {
    prompt: "",
    model: config.imageModel,
    size: config.size,
    count: atlasGenerationCount(config.canvasImageCount || config.count),
  });
  const placement = connectedPlacement(source.id, output);
  return {
    ...placement,
    commands: [
      { type: "patch-node", id: source.id, patch: { data: { ...source.metadata, content: prompt, prompt, status: "success" } } },
      ...placement.commands,
    ],
  };
}

/** Adds a video recipe without modifying the source text or its existing branches. */
export function planAtlasTextToVideo(
  source: CanvasNodeData | undefined,
  metadata: CanvasNodeMetadata,
  title: string,
): AtlasGenerationPlacement | null {
  if (source?.type !== CanvasNodeType.Text) return null;
  const output = placeParameterNode(source, metadata);
  output.title = title;
  return connectedPlacement(source.id, output);
}

/** Builds the instruction and reference branches of an image analysis request. */
export function planAtlasImageReversePrompt(input: Readonly<{
  source: CanvasNodeData | undefined;
  model: string;
  instruction: string;
  instructionTitle: string;
  configurationTitle: string;
  compose: (imageId: string, instructionId: string) => string;
}>): AtlasGenerationPlacement | null {
  const { source } = input;
  if (source?.type !== CanvasNodeType.Image || !source.metadata?.content) return null;
  const text = createAtlasNode(CanvasNodeType.Text, { x: 0, y: 0 }, {
    content: input.instruction,
    prompt: input.instruction,
    status: "success",
    fontSize: 14,
  });
  text.title = input.instructionTitle;
  text.position = { x: source.position.x + source.width + 96, y: source.position.y + (source.height - text.height) / 2 };
  const composerContent = input.compose(source.id, text.id);
  const output = placeParameterNode(text, {
    generationMode: "text",
    model: input.model,
    count: 1,
    composerContent,
  });
  output.title = input.configurationTitle;
  return {
    panelId: output.id,
    commands: [
      ...planAtlasNodeInsertion([text, output], [
        { id: nanoid(), fromNodeId: source.id, toNodeId: output.id },
        { id: nanoid(), fromNodeId: text.id, toNodeId: output.id },
      ]),
      { type: "select", nodeIds: [output.id] },
    ],
  };
}
