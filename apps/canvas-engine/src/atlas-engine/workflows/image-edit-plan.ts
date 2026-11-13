import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { planAtlasNodeInsertion } from "@/atlas-engine/interaction/node-commands";
import { atlasImageMetadata, buildAtlasImageGenerationMetadata } from "@/atlas-engine/model/node-factory";
import { fitAtlasNodeSize } from "@/atlas-engine/model/node-size";
import type { requestEdit } from "@/services/api/image";
import { throwIfAborted } from "@/services/media-storage-runtime";
import type { UploadedImage, uploadImage } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

export type AtlasImageEditPlan = Readonly<{
  source: CanvasNodeData;
  outputId: string;
  config: AiConfig;
  prompt: string;
  references: ReferenceImage[];
  generate: boolean;
  nodes: readonly CanvasNodeData[];
  commands: ReturnType<typeof planAtlasNodeInsertion>;
  bounds: Readonly<{ width: number; height: number }>;
  metadata: CanvasNodeMetadata;
}>;

function sourceReference(node: CanvasNodeData): ReferenceImage {
  return {
    id: node.id,
    name: `${node.title || node.id}.png`,
    type: node.metadata?.mimeType || "image/png",
    dataUrl: node.metadata?.content || "",
    storageKey: node.metadata?.storageKey,
  };
}

export function atlasImageSourceUnchanged(
  original: CanvasNodeData,
  current: CanvasNodeData | undefined,
): boolean {
  return current?.id === original.id &&
    current.type === CanvasNodeType.Image &&
    Boolean(current.metadata?.content) &&
    current.metadata?.content === original.metadata?.content &&
    current.metadata?.storageKey === original.metadata?.storageKey;
}

/** Rejects stale source/project responses before they submit another request or commit. */
export function createAtlasImageEditGuard(
  source: CanvasNodeData,
  signal: AbortSignal,
  readSource: () => CanvasNodeData | undefined,
  isScopeCurrent: () => boolean,
) {
  return () => {
    throwIfAborted(signal);
    if (!isScopeCurrent() || !atlasImageSourceUnchanged(source, readSource()))
      throw new DOMException("Image edit context has changed", "AbortError");
  };
}

function outputNode(
  source: CanvasNodeData,
  id: string,
  title: string,
  dimensions: Readonly<{ width: number; height: number }>,
  metadata: CanvasNodeMetadata,
): CanvasNodeData {
  return {
    id,
    type: CanvasNodeType.Image,
    title,
    width: dimensions.width,
    height: dimensions.height,
    position: { x: source.position.x + source.width + 96, y: source.position.y },
    metadata,
  };
}

export function planAtlasMaskImageEdit(input: Readonly<{
  source: CanvasNodeData;
  outputId: string;
  mask: UploadedImage;
  config: AiConfig;
  prompt: string;
  title: string;
  maskTitle: string;
  generate: boolean;
}>): AtlasImageEditPlan {
  const maskId = nanoid();
  const mask: CanvasNodeData = {
    ...outputNode(input.source, maskId, input.maskTitle, input.source, atlasImageMetadata(input.mask)),
    position: { x: input.source.position.x, y: input.source.position.y + input.source.height + 96 },
  };
  const references = [sourceReference(input.source), {
    id: maskId,
    name: "mask.png",
    type: input.mask.mimeType || "image/png",
    dataUrl: input.mask.url,
    storageKey: input.mask.storageKey,
  }];
  const metadata = buildAtlasImageGenerationMetadata("edit", input.config, 1, references);
  const output = outputNode(input.source, input.outputId, input.title, input.source,
    input.generate ? { ...metadata, prompt: input.prompt, status: "loading" } : { prompt: input.prompt });
  const nodes = [mask, output];
  return {
    ...input,
    references,
    nodes,
    metadata,
    bounds: { width: input.source.width, height: input.source.height },
    commands: [
      ...planAtlasNodeInsertion(nodes, [
        { id: nanoid(), fromNodeId: input.source.id, toNodeId: input.outputId },
        { id: nanoid(), fromNodeId: maskId, toNodeId: input.outputId },
      ]),
      { type: "select", nodeIds: [input.outputId] },
    ],
  };
}

export function planAtlasAngleImageEdit(input: Readonly<{
  source: CanvasNodeData;
  outputId: string;
  config: AiConfig;
  prompt: string;
  title: string;
}>): AtlasImageEditPlan {
  const references = [sourceReference(input.source)];
  const metadata = { ...buildAtlasImageGenerationMetadata("edit", input.config, 1, references), generationMode: "image" as const };
  const output = outputNode(input.source, input.outputId, input.title, { width: 340, height: 240 },
    { ...metadata, prompt: input.prompt, status: "loading" });
  return {
    ...input,
    generate: true,
    references,
    nodes: [output],
    metadata,
    bounds: NODE_DEFAULT_SIZE[CanvasNodeType.Image],
    commands: planAtlasNodeInsertion([output], [
      { id: nanoid(), fromNodeId: input.source.id, toNodeId: input.outputId },
    ]),
  };
}

/** Provider work is isolated from document mutation and checked after every await. */
export async function executeAtlasImageEdit(input: Readonly<{
  plan: AtlasImageEditPlan;
  signal: AbortSignal;
  assertCurrent: () => void;
  edit: typeof requestEdit;
  store: typeof uploadImage;
}>): Promise<UploadedImage> {
  input.assertCurrent();
  const images = await input.edit(input.plan.config, input.plan.prompt, input.plan.references, { signal: input.signal });
  input.assertCurrent();
  const image = images[0];
  if (!image?.dataUrl) throw new Error("Image provider returned no image");
  const stored = await input.store(image.dataUrl, { signal: input.signal });
  input.assertCurrent();
  return stored;
}

export function applyAtlasImageEditMedia(
  nodes: readonly CanvasNodeData[],
  plan: AtlasImageEditPlan,
  image: UploadedImage,
): CanvasNodeData[] {
  if (!atlasImageSourceUnchanged(plan.source, nodes.find((node) => node.id === plan.source.id))) return nodes.slice();
  const size = fitAtlasNodeSize(image.width, image.height, plan.bounds.width, plan.bounds.height);
  return nodes.map((node) => node.id !== plan.outputId ? node : {
    ...node,
    ...size,
    metadata: { ...node.metadata, ...atlasImageMetadata(image), prompt: plan.prompt, ...plan.metadata, errorDetails: undefined },
  });
}

export function restoreAtlasImageEditCancellation(
  nodes: readonly CanvasNodeData[],
  outputId: string,
): CanvasNodeData[] {
  return nodes.map((node) => node.id === outputId && node.metadata?.status === "loading"
    ? { ...node, metadata: { ...node.metadata, status: "idle", errorDetails: undefined } }
    : node);
}
