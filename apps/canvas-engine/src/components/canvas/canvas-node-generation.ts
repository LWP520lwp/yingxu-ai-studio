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

export type NodeGenerationContext = {
  prompt: string;
  referenceImages: ReferenceImage[];
  referenceVideos: ReferenceVideo[];
  referenceAudios: ReferenceAudio[];
  textCount: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
};

type NodeGenerationResourceInput = {
  nodeId: string;
  type: "text" | "image" | "video" | "audio";
  title: string;
  text?: string;
  image?: ReferenceImage;
  video?: ReferenceVideo;
  audio?: ReferenceAudio;
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
  const sourceNode = options?.resourceIndex?.getNode(nodeId) ?? nodes.find((node) => node.id === nodeId);
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
  if (promptContainsImageMention(prompt, nodes, resourceIndex)) return composerInputs;

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
  nodes: CanvasNodeData[],
  resourceIndex: CanvasResourceIndex,
) {
  for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
    const id = match[1];
    const node = resourceIndex.getNode(id);
    if (!node) return true;
    if (resourceKind(node) === "image") return true;
    if (
      node.type === CanvasNodeType.Group &&
      resourceIndex.getGroupResourceNodes(node.id).some(
        (child) => resourceKind(child) === "image",
      )
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
  const resources = flattenGenerationInputs(inputs);
  const textBlocks = resources
    .filter(
      (input): input is NodeGenerationResourceInput =>
        input.type === "text" && Boolean(input.text),
    )
    .map((input, index) =>
      textBlock(generationLabel("text", index), input.text!),
    );
  const referenceImages = resources.flatMap((input) =>
    input.image ? [input.image] : [],
  );
  const referenceVideos = resources.flatMap((input) =>
    input.video ? [input.video] : [],
  );
  const referenceAudios = resources.flatMap((input) =>
    input.audio ? [input.audio] : [],
  );
  const textCount = resources.filter((input) => input.type === "text").length;

  return {
    prompt: textBlocks.length
      ? `${prompt}\n\n${textBlocks.join("\n\n")}`
      : prompt,
    referenceImages,
    referenceVideos,
    referenceAudios,
    textCount,
    imageCount: referenceImages.length,
    videoCount: referenceVideos.length,
    audioCount: referenceAudios.length,
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
  const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
  const selectedResources: NodeGenerationResourceInput[] = [];
  const labelByNodeId = new Map<string, string>();
  const textBlocks: string[] = [];
  const counts: ResourceCounts = { image: 0, video: 0, audio: 0, text: 0 };
  let hasMention = false;
  let cursor = 0;
  let resultPrompt = "";

  for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
    const start = match.index;
    if (start === undefined) continue;
    hasMention = true;
    resultPrompt += prompt.slice(cursor, start);

    const input = inputByNodeId.get(match[1]);
    if (input) {
      const labels = flattenGenerationInputs([input]).map((resource) => {
        let label = labelByNodeId.get(resource.nodeId);
        if (!label) {
          label = generationLabel(resource.type, counts[resource.type]++);
          labelByNodeId.set(resource.nodeId, label);
          if (resource.type === "text")
            textBlocks.push(textBlock(label, resource.text || ""));
          else selectedResources.push(resource);
        }
        return resource.type === "text" ? `【${label}】` : label;
      });
      resultPrompt += labels.join("、");
    }
    cursor = start + match[0].length;
  }

  resultPrompt += prompt.slice(cursor);
  if (textBlocks.length)
    resultPrompt = `${resultPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;

  if (!hasMention) return emptyContext(prompt);

  const referenceImages = selectedResources.flatMap((input) =>
    input.image ? [input.image] : [],
  );
  const referenceVideos = selectedResources.flatMap((input) =>
    input.video ? [input.video] : [],
  );
  const referenceAudios = selectedResources.flatMap((input) =>
    input.audio ? [input.audio] : [],
  );
  return {
    prompt: resultPrompt,
    referenceImages,
    referenceVideos,
    referenceAudios,
    textCount: counts.text,
    imageCount: referenceImages.length,
    videoCount: referenceVideos.length,
    audioCount: referenceAudios.length,
  };
}

export function buildNodeGenerationInputs(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
  resourceIndex: CanvasResourceIndex = createCanvasResourceIndex(nodes, connections),
): NodeGenerationInput[] {
  const sources = resourceIndex.getGenerationResourceNodes(nodeId);
  const inputs: NodeGenerationInput[] = [];
  const includedSourceIds = new Set<string>();

  for (const source of sources) {
    if (includedSourceIds.has(source.id)) continue;
    includedSourceIds.add(source.id);

    if (source.type === CanvasNodeType.Group) {
      const children = resourceIndex.getGroupResourceNodes(source.id).flatMap(
        readNodeGenerationResource,
      );
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
  if (node.type === CanvasNodeType.Image && metadata?.content) {
    return [
      {
        nodeId: node.id,
        type: "image",
        title: node.title,
        image: {
          id: node.id,
          name: `${node.title || node.id}.png`,
          type: metadata.mimeType || "image/png",
          dataUrl: metadata.content,
          storageKey: metadata.storageKey,
        },
      },
    ];
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
  if (node.type === CanvasNodeType.Text)
    return node.metadata?.content || node.metadata?.prompt || "";
  return node.metadata?.prompt || "";
}

function textBlock(label: string, text: string) {
  return `【${label}】\n${text}`;
}

function generationLabel(
  type: NodeGenerationResourceInput["type"],
  index: number,
) {
  if (type === "image") return imageReferenceLabel(index);
  if (type === "video")
    return i18n.t("canvas.configNode.videoReferences") + ` ${index + 1}`;
  if (type === "audio")
    return i18n.t("canvas.configNode.audioReferences") + ` ${index + 1}`;
  return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}
