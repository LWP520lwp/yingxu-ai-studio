import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import i18n from "@/i18n";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
  id: string;
  nodeId: string;
  kind: CanvasResourceKind;
  label: string;
  valueToken?: string;
  title: string;
  previewUrl?: string;
  text?: string;
  active: boolean;
};

type ResourceDescriptor = {
  kind: CanvasResourceKind;
  mediaUrl?: string;
  body?: string;
};

type GraphRecord = {
  node: CanvasNodeData;
  order: number;
};

type ImageInput = {
  id: string;
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  url: string;
  dataUrl: string;
};

const EMPTY_NODES: CanvasNodeData[] = [];
const EMPTY_CONNECTIONS: CanvasConnection[] = [];

function readDescriptor(node: CanvasNodeData): ResourceDescriptor | undefined {
  const content = node.metadata?.content;
  switch (node.type) {
    case CanvasNodeType.Image:
      return content ? { kind: "image", mediaUrl: content } : undefined;
    case CanvasNodeType.Video:
      return content ? { kind: "video", mediaUrl: content } : undefined;
    case CanvasNodeType.Audio:
      return content ? { kind: "audio", mediaUrl: content } : undefined;
    case CanvasNodeType.Text: {
      const body = content || node.metadata?.prompt;
      return body ? { kind: "text", body } : undefined;
    }
    default: {
      const custom = getNodeDefinition(node.type)?.resource?.(node);
      return custom
        ? { kind: custom.kind, mediaUrl: custom.url, body: custom.text }
        : undefined;
    }
  }
}

function appendIndex<K, V>(index: Map<K, V[]>, key: K, value: V) {
  const values = index.get(key);
  if (values) values.push(value);
  else index.set(key, [value]);
}

function uniqueInOrder<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function formatResourceLabel(kind: CanvasResourceKind, ordinal: number) {
  switch (kind) {
    case "image":
      return imageReferenceLabel(ordinal - 1);
    case "video":
      return `${i18n.t("canvas.configNode.videoReferences")} ${ordinal}`;
    case "audio":
      return `${i18n.t("canvas.configNode.audioReferences")} ${ordinal}`;
    case "text":
      return i18n.t("canvas.composer.resources.text", { index: ordinal });
  }
}

/** Builds one immutable lookup snapshot for all resource and mention queries. */
export class CanvasResourceIndex {
  private readonly records = new Map<string, GraphRecord>();
  private readonly resources = new Map<string, ResourceDescriptor>();
  private readonly children = new Map<string, CanvasNodeData[]>();
  private readonly upstream = new Map<string, string[]>();
  private readonly downstream = new Map<string, string[]>();
  private readonly groupCache = new Map<string, CanvasNodeData[]>();
  private readonly mentionCache = new Map<string, CanvasNodeData[]>();
  private readonly generationCache = new Map<string, CanvasNodeData[]>();
  private readonly referenceCache = new Map<string, CanvasResourceReference[]>();
  private completeReferenceList?: CanvasResourceReference[];

  constructor(
    private readonly sourceNodes: readonly CanvasNodeData[],
    private readonly sourceConnections: readonly CanvasConnection[],
  ) {
    for (let order = 0; order < sourceNodes.length; order += 1) {
      const node = sourceNodes[order];
      if (!this.records.has(node.id)) this.records.set(node.id, { node, order });
      const groupId = node.metadata?.groupId;
      if (groupId) appendIndex(this.children, groupId, node);
      const descriptor = readDescriptor(node);
      if (descriptor) this.resources.set(node.id, descriptor);
    }

    for (const connection of sourceConnections) {
      appendIndex(this.upstream, connection.toNodeId, connection.fromNodeId);
      appendIndex(this.downstream, connection.fromNodeId, connection.toNodeId);
    }
  }

  matchesSnapshot(nodes: readonly CanvasNodeData[], connections: readonly CanvasConnection[]) {
    return nodes === this.sourceNodes && connections === this.sourceConnections;
  }

  getNode(nodeId: string) {
    return this.records.get(nodeId)?.node;
  }

  getMentionResourceNodes(nodeId: string) {
    const cached = this.mentionCache.get(nodeId);
    if (cached) return cached;

    const configured = this.configuredInputs(nodeId);
    const direct = configured.length ? configured : this.connectedInputs(nodeId);
    const selected = direct.length
      ? this.expandGroups(direct)
      : this.selfReference(nodeId);
    this.mentionCache.set(nodeId, selected);
    return selected;
  }

  getGenerationResourceNodes(nodeId: string) {
    const cached = this.generationCache.get(nodeId);
    if (cached) return cached;

    const configured = this.configuredInputs(nodeId);
    const result = configured.length ? configured : this.connectedInputs(nodeId);
    this.generationCache.set(nodeId, result);
    return result;
  }

  buildNodeMentionReferences(nodeId: string) {
    const cached = this.referenceCache.get(nodeId);
    if (cached) return cached;
    const result = this.labelNodes(this.getMentionResourceNodes(nodeId));
    this.referenceCache.set(nodeId, result);
    return result;
  }

  buildCanvasResourceReferences() {
    if (!this.completeReferenceList) {
      this.completeReferenceList = this.labelNodes(this.sourceNodes);
    }
    return this.completeReferenceList;
  }

  getGroupResourceNodes(groupId: string) {
    const cached = this.groupCache.get(groupId);
    if (cached) return cached;

    const result: CanvasNodeData[] = [];
    const found = new Set<string>();
    const expandedGroups = new Set<string>();
    const pending = [groupId];
    while (pending.length) {
      const currentId = pending.pop()!;
      if (expandedGroups.has(currentId)) continue;
      expandedGroups.add(currentId);

      for (const child of this.children.get(currentId) ?? []) {
        if (child.type === CanvasNodeType.Group) {
          pending.push(child.id);
        } else if (this.resources.has(child.id) && !found.has(child.id)) {
          found.add(child.id);
          result.push(child);
        }
      }
    }

    result.sort((left, right) =>
      (this.records.get(left.id)?.order ?? 0) - (this.records.get(right.id)?.order ?? 0),
    );
    this.groupCache.set(groupId, result);
    return result;
  }

  isReferenceNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Group
      ? this.getGroupResourceNodes(node.id).length > 0
      : this.resources.has(node.id);
  }

  private connectedInputs(nodeId: string) {
    const candidates: CanvasNodeData[] = [];
    for (const sourceId of this.upstream.get(nodeId) ?? []) {
      const source = this.records.get(sourceId)?.node;
      if (source && this.isReferenceNode(source)) candidates.push(source);
    }
    return uniqueInOrder(candidates, (node) => node.id);
  }

  private configuredInputs(nodeId: string) {
    for (const configId of this.downstream.get(nodeId) ?? []) {
      const config = this.records.get(configId)?.node;
      if (config?.type !== CanvasNodeType.Config) continue;
      return this.connectedInputs(configId).filter((node) => node.id !== nodeId);
    }
    return [];
  }

  private expandGroups(nodes: readonly CanvasNodeData[]) {
    const expanded: CanvasNodeData[] = [];
    for (const node of nodes) {
      if (node.type === CanvasNodeType.Group) expanded.push(...this.getGroupResourceNodes(node.id));
      else expanded.push(node);
    }
    return uniqueInOrder(expanded, (node) => node.id);
  }

  private selfReference(nodeId: string) {
    const node = this.records.get(nodeId)?.node;
    return node && node.type !== CanvasNodeType.Group && this.isReferenceNode(node) ? [node] : [];
  }

  private labelNodes(nodes: readonly CanvasNodeData[]) {
    const ordinal = new Map<CanvasResourceKind, number>();
    const references: CanvasResourceReference[] = [];

    for (const node of uniqueInOrder(nodes, (item) => item.id)) {
      const resource = this.resources.get(node.id);
      if (!resource) continue;
      const next = (ordinal.get(resource.kind) ?? 0) + 1;
      ordinal.set(resource.kind, next);
      const label = formatResourceLabel(resource.kind, next);
      references.push({
        id: node.id,
        nodeId: node.id,
        kind: resource.kind,
        label,
        title: node.title || label,
        previewUrl: node.metadata?.content || resource.mediaUrl,
        text: resource.kind === "text" ? resource.body : undefined,
        active: true,
      });
    }
    return references;
  }
}

export function createCanvasResourceIndex(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[] = EMPTY_CONNECTIONS,
) {
  return new CanvasResourceIndex(nodes, connections);
}

export function buildNodeMentionReferences(
  node: CanvasNodeData,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
) {
  return createCanvasResourceIndex(nodes, connections).buildNodeMentionReferences(node.id);
}

export function buildCanvasResourceReferences(nodes: CanvasNodeData[]) {
  return createCanvasResourceIndex(nodes).buildCanvasResourceReferences();
}

export async function resolveCanvasReferenceImages(
  references: CanvasResourceReference[],
  nodes: CanvasNodeData[],
): Promise<ImageInput[]> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const images = references.filter((reference) => reference.kind === "image");
  return Promise.all(images.map(async (reference) => {
    const node = nodesById.get(reference.nodeId);
    if (!node) {
      throw new Error(i18n.t("agent.composer.mentions.resourceMissing", { title: reference.title }));
    }

    const metadata = node.metadata;
    const dataUrl = await imageToDataUrl({ storageKey: metadata?.storageKey, url: reference.previewUrl });
    if (!dataUrl.startsWith("data:image/")) {
      throw new Error(i18n.t("agent.composer.mentions.imageReadFailed", { title: reference.title }));
    }

    const details = metadata?.naturalWidth && metadata.naturalHeight
      ? {
          width: metadata.naturalWidth,
          height: metadata.naturalHeight,
          mimeType: metadata.mimeType || dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png",
        }
      : await readImageMeta(dataUrl);

    return {
      id: `canvas:${node.id}`,
      name: reference.title,
      type: metadata?.mimeType || details.mimeType,
      size: metadata?.bytes || getDataUrlByteSize(dataUrl),
      width: details.width,
      height: details.height,
      url: reference.previewUrl || dataUrl,
      dataUrl,
    };
  }));
}

export function getMentionResourceNodes(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
) {
  return createCanvasResourceIndex(nodes, connections).getMentionResourceNodes(nodeId);
}

export function getGenerationResourceNodes(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
) {
  return createCanvasResourceIndex(nodes, connections).getGenerationResourceNodes(nodeId);
}

export function isCanvasReferenceNode(node: CanvasNodeData, nodes: CanvasNodeData[]) {
  return createCanvasResourceIndex(nodes).isReferenceNode(node);
}

export function getGroupResourceNodes(groupId: string, nodes: CanvasNodeData[]) {
  return createCanvasResourceIndex(nodes).getGroupResourceNodes(groupId);
}

export type CanvasResourceIndexApi = ReturnType<typeof createCanvasResourceIndex>;
