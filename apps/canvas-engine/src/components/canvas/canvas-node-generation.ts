import type { AiTextMessage } from "@/services/api/image";
import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from "@/types/canvas";
import {
  createCanvasResourceIndex,
  type CanvasResourceIndex,
} from "@/lib/canvas/canvas-resource-references";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { readCanvasImageReference } from "@/lib/canvas/canvas-image-reference";

type ResourceReferences = {
  image: ReferenceImage;
  video: ReferenceVideo;
  audio: ReferenceAudio;
};
type ResourceKind = "text" | keyof ResourceReferences;
export type NodeResourceCounts = { [K in ResourceKind as `${K}Count`]: number };

export type NodeGenerationContext = NodeResourceCounts & {
  prompt: string;
  referenceImages: ReferenceImage[];
  referenceVideos: ReferenceVideo[];
  referenceAudios: ReferenceAudio[];
};

type NodeGenerationResourceInput = Partial<ResourceReferences> & {
  nodeId: string;
  type: ResourceKind;
  title: string;
  text?: string;
};

type NodeGenerationGroupInput = {
  nodeId: string;
  type: "group";
  title: string;
  children: NodeGenerationResourceInput[];
};

export type NodeGenerationInput =
  NodeGenerationResourceInput | NodeGenerationGroupInput;

type ResourceCounts = Record<NodeGenerationResourceInput["type"], number>;

type PromptPart =
  { kind: "text"; value: string } | { kind: "resource"; nodeId: string };

function splitPromptResources(prompt: string): PromptPart[] {
  const parts: PromptPart[] = [];
  let cursor = 0;

  for (const match of prompt.matchAll(/@\[node:([^\]]*)\]/g)) {
    const marker = match.index ?? cursor;
    const token = match[0];
    const nodeId = match[1];
    if (marker > cursor) {
      parts.push({ kind: "text", value: prompt.slice(cursor, marker) });
    }
    parts.push(
      nodeId ? { kind: "resource", nodeId } : { kind: "text", value: token },
    );
    cursor = marker + token.length;
  }

  if (cursor < prompt.length) {
    parts.push({ kind: "text", value: prompt.slice(cursor) });
  }
  if (!parts.length) parts.push({ kind: "text", value: prompt });
  return parts;
}

function emptyContext(prompt: string): NodeGenerationContext {
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

export function buildNodeGenerationContext(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
  prompt: string,
  options?: { frameMode?: boolean; resourceIndex?: CanvasResourceIndex },
): NodeGenerationContext {
  const sourceNode =
    options?.resourceIndex?.getNode(nodeId) ??
    nodes.find((node) => node.id === nodeId);
  const frameMode =
    options?.frameMode ??
    (sourceNode?.metadata?.videoMode === "frames" &&
      (sourceNode.type === CanvasNodeType.Video ||
        sourceNode.metadata.generationMode === "video"));
  const relevantConnections = frameMode
    ? connections.filter(
        (connection) =>
          connection.toNodeId === nodeId && connection.fromNodeId !== nodeId,
      )
    : connections;
  const reusableIndex = options?.resourceIndex;
  const resourceIndex = frameMode
    ? createCanvasResourceIndex(nodes, relevantConnections)
    : reusableIndex?.matchesSnapshot(nodes, relevantConnections)
      ? reusableIndex
      : createCanvasResourceIndex(nodes, relevantConnections);
  const inputs = buildNodeGenerationInputs(
    nodeId,
    nodes,
    relevantConnections,
    resourceIndex,
  );

  if (frameMode)
    return buildFrameGenerationContext(
      nodeId,
      sourceNode,
      inputs,
      nodes,
      prompt,
      resourceIndex,
    );
  if (
    sourceNode?.type === CanvasNodeType.Config &&
    sourceNode.metadata?.composerContent?.trim()
  ) {
    return buildComposerGenerationContext(inputs, prompt);
  }
  return buildResourceGenerationContext(inputs, prompt);
}

function buildFrameGenerationContext(
  nodeId: string,
  sourceNode: CanvasNodeData | undefined,
  inputs: NodeGenerationInput[],
  nodes: CanvasNodeData[],
  prompt: string,
  resourceIndex: CanvasResourceIndex,
): NodeGenerationContext {
  const resources = flattenGenerationInputs(inputs);
  const composerInputs = buildComposerGenerationContext(
    [...inputs, ...resources],
    prompt,
  );

  // An explicit image (or unresolved) token means the user selected the frame
  // set. In that case, never replace it with every connected image.
  if (promptContainsImageMention(prompt, resourceIndex)) return composerInputs;

  const connectedFrames = resources
    .map((input) => input.image)
    .filter((image): image is ReferenceImage => Boolean(image));
  const context =
    sourceNode?.type === CanvasNodeType.Config &&
    sourceNode.metadata?.composerContent?.trim()
      ? composerInputs
      : buildResourceGenerationContext(inputs, prompt);
  return {
    ...context,
    referenceImages: connectedFrames,
    imageCount: connectedFrames.length,
  };
}

function promptContainsImageMention(
  prompt: string,
  resourceIndex: CanvasResourceIndex,
) {
  for (const part of splitPromptResources(prompt)) {
    if (part.kind !== "resource") continue;
    const id = part.nodeId;
    const node = resourceIndex.getNode(id);
    if (!node) return true;
    if (resourceKind(node) === "image") return true;
    if (
      node.type === CanvasNodeType.Group &&
      resourceIndex
        .getGroupResourceNodes(node.id)
        .some((child) => resourceKind(child) === "image")
    )
      return true;
  }
  return false;
}

function resourceKind(node: CanvasNodeData) {
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
  return getNodeDefinition(node.type)?.resource?.(node)?.kind;
}

function buildResourceGenerationContext(
  inputs: NodeGenerationInput[],
  prompt: string,
): NodeGenerationContext {
  const context = emptyContext(prompt);
  const textBlocks: string[] = [];
  for (const input of flattenGenerationInputs(inputs)) {
    if (input.type === "text") {
      context.textCount += 1;
      if (input.text) {
        textBlocks.push(
          textBlock(generationLabel("text", textBlocks.length), input.text),
        );
      }
    }
    if (input.image) context.referenceImages.push(input.image);
    if (input.video) context.referenceVideos.push(input.video);
    if (input.audio) context.referenceAudios.push(input.audio);
  }

  return {
    ...context,
    prompt: textBlocks.length
      ? `${prompt}\n\n${textBlocks.join("\n\n")}`
      : prompt,
    imageCount: context.referenceImages.length,
    videoCount: context.referenceVideos.length,
    audioCount: context.referenceAudios.length,
  };
}

export function frameReferenceIssue(imageCount: number): string | undefined {
  if (imageCount === 0) return i18n.t("canvas.references.frameRequired");
  if (imageCount > 2)
    return i18n.t("canvas.references.frameLimit", { count: imageCount });
  return undefined;
}

function buildComposerGenerationContext(
  inputs: NodeGenerationInput[],
  prompt: string,
): NodeGenerationContext {
  const parts = splitPromptResources(prompt);
  if (parts.every((part) => part.kind === "text")) return emptyContext(prompt);
  const available = new Map(inputs.map((input) => [input.nodeId, input]));
  const bindings = new Map<string, { label: string; resource: NodeGenerationResourceInput }>();
  const ordinal: ResourceCounts = { image: 0, video: 0, audio: 0, text: 0 };
  const rendered = parts.map((part) => {
    if (part.kind === "text") return part.value;
    const selected = available.get(part.nodeId);
    if (!selected) return "";
    return flattenGenerationInputs([selected]).map((resource) => {
      let binding = bindings.get(resource.nodeId);
      if (!binding) {
        binding = { resource, label: generationLabel(resource.type, ordinal[resource.type]++) };
        bindings.set(resource.nodeId, binding);
      }
      return resource.type === "text" ? `【${binding.label}】` : binding.label;
    }).join("、");
  }).join("");

  const result = emptyContext(rendered);
  const appendix: string[] = [];
  for (const { resource, label } of bindings.values()) {
    if (resource.type === "text") {
      result.textCount++;
      appendix.push(textBlock(label, resource.text ?? ""));
    }
    if (resource.image) result.referenceImages.push(resource.image);
    if (resource.video) result.referenceVideos.push(resource.video);
    if (resource.audio) result.referenceAudios.push(resource.audio);
  }
  if (appendix.length) result.prompt = [rendered.trim(), ...appendix].join("\n\n");
  result.imageCount = result.referenceImages.length;
  result.videoCount = result.referenceVideos.length;
  result.audioCount = result.referenceAudios.length;
  return result;
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
  const sources = resourceIndex.getGenerationResourceNodes(nodeId);
  const inputs: NodeGenerationInput[] = [];
  const includedSourceIds = new Set<string>();

  for (const source of sources) {
    if (includedSourceIds.has(source.id)) continue;
    includedSourceIds.add(source.id);

    if (source.type === CanvasNodeType.Group) {
      const children = resourceIndex
        .getGroupResourceNodes(source.id)
        .flatMap(readNodeGenerationResource);
      if (children.length)
        inputs.push({
          nodeId: source.id,
          type: "group",
          title: source.title,
          children,
        });
      continue;
    }
    inputs.push(...readNodeGenerationResource(source));
  }

  return inputs;
}

function flattenGenerationInputs(
  inputs: NodeGenerationInput[],
): NodeGenerationResourceInput[] {
  const seenNodeIds = new Set<string>();
  const flattened: NodeGenerationResourceInput[] = [];

  for (const input of inputs) {
    const resources = input.type === "group" ? input.children : [input];
    for (const resource of resources) {
      if (seenNodeIds.has(resource.nodeId)) continue;
      seenNodeIds.add(resource.nodeId);
      flattened.push(resource);
    }
  }

  return flattened;
}

function readNodeGenerationResource(
  node: CanvasNodeData,
): NodeGenerationResourceInput[] {
  const metadata = node.metadata;
  if (node.type === CanvasNodeType.Image) {
    const reference = readCanvasImageReference(node);
    if (reference) return [{ nodeId: node.id, type: "image", title: node.title, image: reference }];
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

  const pluginResource = getNodeDefinition(node.type)?.resource?.(node);
  if (pluginResource?.kind === "image" && pluginResource.url) {
    return [
      {
        nodeId: node.id,
        type: "image",
        title: node.title,
        image: {
          id: node.id,
          name: `${node.title || node.id}.png`,
          type: metadata?.mimeType || "image/png",
          dataUrl: pluginResource.url,
          storageKey: metadata?.storageKey,
        },
      },
    ];
  }
  if (pluginResource?.kind === "video" && pluginResource.url) {
    return [
      {
        nodeId: node.id,
        type: "video",
        title: node.title,
        video: {
          id: node.id,
          name: `${node.title || node.id}.mp4`,
          type: metadata?.mimeType || "video/mp4",
          url: pluginResource.url,
          storageKey: metadata?.storageKey,
          bytes: metadata?.bytes,
          width: metadata?.naturalWidth,
          height: metadata?.naturalHeight,
          durationMs: metadata?.durationMs,
        },
      },
    ];
  }
  if (pluginResource?.kind === "audio" && pluginResource.url) {
    return [
      {
        nodeId: node.id,
        type: "audio",
        title: node.title,
        audio: {
          id: node.id,
          name: `${node.title || node.id}.mp3`,
          type: metadata?.mimeType || "audio/mpeg",
          url: pluginResource.url,
          storageKey: metadata?.storageKey,
          durationMs: metadata?.durationMs,
        },
      },
    ];
  }
  if (pluginResource?.kind === "text" && pluginResource.text) {
    return [
      {
        nodeId: node.id,
        type: "text",
        title: node.title,
        text: pluginResource.text,
      },
    ];
  }

  const text = readNodeTextInput(node);
  return text
    ? [{ nodeId: node.id, type: "text", title: node.title, text }]
    : [];
}

export function buildNodeResponseMessages(
  context: NodeGenerationContext,
): AiTextMessage[] {
  if (!context.referenceImages.length)
    return [{ role: "user", content: context.prompt }];
  return [
    {
      role: "user",
      content: [
        { type: "text", text: context.prompt },
        ...context.referenceImages.map((image) => ({
          type: "image_url" as const,
          image_url: { url: image.dataUrl },
        })),
      ],
    },
  ];
}

export async function hydrateNodeGenerationContext(
  context: NodeGenerationContext,
  options: { signal?: AbortSignal } = {},
) {
  const { imageToDataUrl } = await import("@/services/image-storage");
  const referenceImages = await Promise.all(
    context.referenceImages.map(async (image) => ({
      ...image,
      dataUrl: await imageToDataUrl(image, options),
    })),
  );
  return { ...context, referenceImages };
}

function readNodeTextInput(node: CanvasNodeData) {
  const data = node.metadata;
  return (node.type === CanvasNodeType.Text ? data?.content : "") || data?.prompt || "";
}

function textBlock(label: string, text: string) {
  return `【${label}】\n${text}`;
}

function generationLabel(
  type: NodeGenerationResourceInput["type"],
  index: number,
) {
  switch (type) {
    case "text": return i18n.t("canvas.composer.resources.text", { index: index + 1 });
    case "image": return imageReferenceLabel(index);
    default: {
      const key = type === "video" ? "canvas.configNode.videoReferences" : "canvas.configNode.audioReferences";
      return `${i18n.t(key)} ${index + 1}`;
    }
  }
}
