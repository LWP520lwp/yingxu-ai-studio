import type { AiTextMessage } from "@/services/api/image";
import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { atlasImageReference as readCanvasImageReference } from "@/atlas-engine/model/image-reference";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from "@/types/canvas";
import {
  CanvasResourceIndex,
  createCanvasResourceIndex,
  type CanvasResourceKind,
} from "@/atlas-engine/model/resource-references";
import { getAtlasNodeDefinition } from "@/atlas-engine/model/node-registry";

type GenerationResource = {
  image: ReferenceImage;
  video: ReferenceVideo;
  audio: ReferenceAudio;
};
type GenerationResourceKind = keyof GenerationResource | "text";

export type NodeResourceCounts = {
  [K in GenerationResourceKind as `${K}Count`]: number;
};

export type NodeGenerationContext = NodeResourceCounts & {
  prompt: string;
  referenceImages: ReferenceImage[];
  referenceVideos: ReferenceVideo[];
  referenceAudios: ReferenceAudio[];
};

type NodeResourceInput = Partial<GenerationResource> & {
  nodeId: string;
  type: GenerationResourceKind;
  title: string;
  text?: string;
};

type GroupResourceInput = {
  nodeId: string;
  type: "group";
  title: string;
  children: NodeResourceInput[];
};

export type NodeGenerationInput = NodeResourceInput | GroupResourceInput;

type PromptPart =
  { kind: "literal"; value: string } | { kind: "reference"; nodeId: string };

type BuildOptions = {
  frameMode?: boolean;
  resourceIndex?: CanvasResourceIndex;
};

function promptParts(prompt: string): PromptPart[] {
  const parts: PromptPart[] = [];
  const token = /@\[node:([^\]]*)\]/g;
  let offset = 0;
  for (const match of prompt.matchAll(token)) {
    const start = match.index ?? offset;
    if (start > offset)
      parts.push({ kind: "literal", value: prompt.slice(offset, start) });
    const nodeId = match[1];
    parts.push(
      nodeId
        ? { kind: "reference", nodeId }
        : { kind: "literal", value: match[0] },
    );
    offset = start + match[0].length;
  }
  if (offset < prompt.length)
    parts.push({ kind: "literal", value: prompt.slice(offset) });
  if (parts.length === 0) parts.push({ kind: "literal", value: prompt });
  return parts;
}

function blankContext(prompt: string): NodeGenerationContext {
  return {
    prompt,
    referenceImages: [],
    referenceVideos: [],
    referenceAudios: [],
    textCount: 0,
    imageCount: 0,
    videoCount: 0,
    audioCount: 0,
  };
}

function flattenInputs(
  inputs: readonly NodeGenerationInput[],
): NodeResourceInput[] {
  const seen = new Set<string>();
  const flattened: NodeResourceInput[] = [];
  for (const entry of inputs) {
    const candidates = entry.type === "group" ? entry.children : [entry];
    for (const candidate of candidates) {
      if (seen.has(candidate.nodeId)) continue;
      seen.add(candidate.nodeId);
      flattened.push(candidate);
    }
  }
  return flattened;
}

function readResource(node: CanvasNodeData): NodeResourceInput[] {
  const metadata = node.metadata;
  if (node.type === CanvasNodeType.Image) {
    const image = readCanvasImageReference(node);
    return image
      ? [{ nodeId: node.id, type: "image", title: node.title, image }]
      : [];
  }

  if (node.type === CanvasNodeType.Video && metadata?.content) {
    return [
      {
        nodeId: node.id,
        type: "video",
        title: node.title,
        video: {
          id: node.id,
          name: `${node.title || node.id}.mp4`,
          type: metadata.mimeType || "video/mp4",
          url: metadata.content,
          storageKey: metadata.storageKey,
          bytes: metadata.bytes,
          width: metadata.naturalWidth,
          height: metadata.naturalHeight,
          durationMs: metadata.durationMs,
        },
      },
    ];
  }

  if (node.type === CanvasNodeType.Audio && metadata?.content) {
    return [
      {
        nodeId: node.id,
        type: "audio",
        title: node.title,
        audio: {
          id: node.id,
          name: `${node.title || node.id}.mp3`,
          type: metadata.mimeType || "audio/mpeg",
          url: metadata.content,
          storageKey: metadata.storageKey,
          durationMs: metadata.durationMs,
        },
      },
    ];
  }

  const supplied = getAtlasNodeDefinition(node.type)?.resource?.(node);
  if (supplied?.url && supplied.kind === "image") {
    return [
      {
        nodeId: node.id,
        type: "image",
        title: node.title,
        image: {
          id: node.id,
          name: `${node.title || node.id}.png`,
          type: metadata?.mimeType || "image/png",
          dataUrl: supplied.url,
          storageKey: metadata?.storageKey,
        },
      },
    ];
  }
  if (supplied?.url && supplied.kind === "video") {
    return [
      {
        nodeId: node.id,
        type: "video",
        title: node.title,
        video: {
          id: node.id,
          name: `${node.title || node.id}.mp4`,
          type: metadata?.mimeType || "video/mp4",
          url: supplied.url,
          storageKey: metadata?.storageKey,
          bytes: metadata?.bytes,
          width: metadata?.naturalWidth,
          height: metadata?.naturalHeight,
          durationMs: metadata?.durationMs,
        },
      },
    ];
  }
  if (supplied?.url && supplied.kind === "audio") {
    return [
      {
        nodeId: node.id,
        type: "audio",
        title: node.title,
        audio: {
          id: node.id,
          name: `${node.title || node.id}.mp3`,
          type: metadata?.mimeType || "audio/mpeg",
          url: supplied.url,
          storageKey: metadata?.storageKey,
          durationMs: metadata?.durationMs,
        },
      },
    ];
  }
  if (supplied?.kind === "text" && supplied.text) {
    return [
      { nodeId: node.id, type: "text", title: node.title, text: supplied.text },
    ];
  }

  const text =
    (node.type === CanvasNodeType.Text ? metadata?.content : "") ||
    metadata?.prompt ||
    "";
  return text
    ? [{ nodeId: node.id, type: "text", title: node.title, text }]
    : [];
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | undefined {
  if (node.type === CanvasNodeType.Image) return "image";
  if (node.type === CanvasNodeType.Video && node.metadata?.content)
    return "video";
  if (node.type === CanvasNodeType.Audio && node.metadata?.content)
    return "audio";
  if (
    node.type === CanvasNodeType.Text &&
    (node.metadata?.content || node.metadata?.prompt)
  )
    return "text";
  return getAtlasNodeDefinition(node.type)?.resource?.(node)?.kind;
}

function resourceLabel(kind: GenerationResourceKind, index: number): string {
  if (kind === "text")
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
  if (kind === "image") return imageReferenceLabel(index);
  const key =
    kind === "video"
      ? "canvas.configNode.videoReferences"
      : "canvas.configNode.audioReferences";
  return `${i18n.t(key)} ${index + 1}`;
}

function textBlock(label: string, text: string) {
  return `【${label}】\n${text}`;
}

export function buildNodeGenerationInputs(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
  resourceIndex: CanvasResourceIndex = createCanvasResourceIndex(
    nodes,
    connections,
  ),
): NodeGenerationInput[] {
  const entries: NodeGenerationInput[] = [];
  const seen = new Set<string>();
  for (const source of resourceIndex.getGenerationResourceNodes(nodeId)) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    if (source.type === CanvasNodeType.Group) {
      const children = resourceIndex
        .getGroupResourceNodes(source.id)
        .flatMap(readResource);
      if (children.length)
        entries.push({
          nodeId: source.id,
          type: "group",
          title: source.title,
          children,
        });
      continue;
    }
    entries.push(...readResource(source));
  }
  return entries;
}

function compilePlainContext(
  inputs: readonly NodeGenerationInput[],
  prompt: string,
): NodeGenerationContext {
  const result = blankContext(prompt);
  const textAppendix: string[] = [];
  for (const input of flattenInputs(inputs)) {
    if (input.type === "text") {
      result.textCount++;
      if (input.text)
        textAppendix.push(
          textBlock(resourceLabel("text", textAppendix.length), input.text),
        );
    }
    if (input.image) result.referenceImages.push(input.image);
    if (input.video) result.referenceVideos.push(input.video);
    if (input.audio) result.referenceAudios.push(input.audio);
  }
  result.prompt = textAppendix.length
    ? `${prompt}\n\n${textAppendix.join("\n\n")}`
    : prompt;
  result.imageCount = result.referenceImages.length;
  result.videoCount = result.referenceVideos.length;
  result.audioCount = result.referenceAudios.length;
  return result;
}

function compileComposerContext(
  inputs: readonly NodeGenerationInput[],
  prompt: string,
): NodeGenerationContext {
  const parts = promptParts(prompt);
  if (parts.every((part) => part.kind === "literal"))
    return blankContext(prompt);

  const available = new Map(inputs.map((input) => [input.nodeId, input]));
  const collected = new Map<
    string,
    { resource: NodeResourceInput; label: string }
  >();
  const indexes: Record<GenerationResourceKind, number> = {
    text: 0,
    image: 0,
    video: 0,
    audio: 0,
  };
  const rendered = parts
    .map((part) => {
      if (part.kind === "literal") return part.value;
      const selected = available.get(part.nodeId);
      if (!selected) return "";
      return flattenInputs([selected])
        .map((resource) => {
          let binding = collected.get(resource.nodeId);
          if (!binding) {
            binding = {
              resource,
              label: resourceLabel(resource.type, indexes[resource.type]++),
            };
            collected.set(resource.nodeId, binding);
          }
          return resource.type === "text"
            ? `【${binding.label}】`
            : binding.label;
        })
        .join("、");
    })
    .join("");

  const context = blankContext(rendered);
  const appendix: string[] = [];
  for (const { resource, label } of collected.values()) {
    if (resource.type === "text") {
      context.textCount++;
      appendix.push(textBlock(label, resource.text ?? ""));
    }
    if (resource.image) context.referenceImages.push(resource.image);
    if (resource.video) context.referenceVideos.push(resource.video);
    if (resource.audio) context.referenceAudios.push(resource.audio);
  }
  if (appendix.length)
    context.prompt = [rendered.trim(), ...appendix].join("\n\n");
  context.imageCount = context.referenceImages.length;
  context.videoCount = context.referenceVideos.length;
  context.audioCount = context.referenceAudios.length;
  return context;
}

function hasImageToken(prompt: string, index: CanvasResourceIndex): boolean {
  for (const part of promptParts(prompt)) {
    if (part.kind !== "reference") continue;
    const node = index.getNode(part.nodeId);
    if (!node || resourceKind(node) === "image") return true;
    if (
      node.type === CanvasNodeType.Group &&
      index
        .getGroupResourceNodes(node.id)
        .some((child) => resourceKind(child) === "image")
    )
      return true;
  }
  return false;
}

export function buildNodeGenerationContext(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
  prompt: string,
  options: BuildOptions = {},
): NodeGenerationContext {
  const sourceNode =
    nodes.find((node) => node.id === nodeId) ??
    options.resourceIndex?.getNode(nodeId);
  const frameMode =
    options.frameMode ??
    Boolean(
      sourceNode?.metadata?.videoMode === "frames" &&
      (sourceNode.type === CanvasNodeType.Video ||
        sourceNode.metadata.generationMode === "video"),
    );
  const activeConnections = frameMode
    ? connections.filter(
        (connection) =>
          connection.toNodeId === nodeId && connection.fromNodeId !== nodeId,
      )
    : connections;
  const cached = options.resourceIndex;
  const index =
    !frameMode && cached?.matchesSnapshot(nodes, activeConnections)
      ? cached
      : createCanvasResourceIndex(nodes, activeConnections);
  const inputs = buildNodeGenerationInputs(
    nodeId,
    nodes,
    activeConnections,
    index,
  );
  const composerMode =
    sourceNode?.type === CanvasNodeType.Config &&
    Boolean(sourceNode.metadata?.composerContent?.trim());

  if (!frameMode)
    return composerMode
      ? compileComposerContext(inputs, prompt)
      : compilePlainContext(inputs, prompt);

  const composerInputs = compileComposerContext(
    [...inputs, ...flattenInputs(inputs)],
    prompt,
  );
  if (hasImageToken(prompt, index)) return composerInputs;

  const frames = flattenInputs(inputs).flatMap((input) =>
    input.image ? [input.image] : [],
  );
  const base = composerMode
    ? composerInputs
    : compilePlainContext(inputs, prompt);
  return { ...base, referenceImages: frames, imageCount: frames.length };
}

export function frameReferenceIssue(imageCount: number): string | undefined {
  if (imageCount < 1) return i18n.t("canvas.references.frameRequired");
  return imageCount > 2
    ? i18n.t("canvas.references.frameLimit", { count: imageCount })
    : undefined;
}

export function buildNodeResponseMessages(
  context: NodeGenerationContext,
): AiTextMessage[] {
  if (context.referenceImages.length === 0)
    return [{ role: "user", content: context.prompt }];
  const content: Extract<AiTextMessage["content"], unknown[]> = [
    { type: "text", text: context.prompt },
    ...context.referenceImages.map((image) => ({
      type: "image_url" as const,
      image_url: { url: image.dataUrl },
    })),
  ];
  return [{ role: "user", content }];
}

export async function hydrateNodeGenerationContext(
  context: NodeGenerationContext,
  options: { signal?: AbortSignal } = {},
): Promise<NodeGenerationContext> {
  const { imageToDataUrl } = await import("@/services/image-storage");
  const images = await Promise.all(
    context.referenceImages.map(async (image) => ({
      ...image,
      dataUrl: await imageToDataUrl(image, options),
    })),
  );
  return { ...context, referenceImages: images };
}
