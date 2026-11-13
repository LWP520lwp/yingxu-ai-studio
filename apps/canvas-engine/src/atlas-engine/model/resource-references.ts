import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import i18n from "@/i18n";
import { getAtlasNodeDefinition } from "@/atlas-engine/model/node-registry";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import { throwIfAborted } from "@/services/media-storage-runtime";
import type { ReferenceImage } from "@/types/image";
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

type Resource = Readonly<{
  kind: CanvasResourceKind;
  url?: string;
  text?: string;
}>;

type MediaReferenceImage = ReferenceImage & {
  size: number;
  width: number;
  height: number;
  url: string;
};

const noConnections: readonly CanvasConnection[] = [];

function mediaFor(node: CanvasNodeData): Resource | undefined {
  const content = node.metadata?.content;
  switch (node.type) {
    case CanvasNodeType.Image:
      return content ? { kind: "image", url: content } : undefined;
    case CanvasNodeType.Video:
      return content ? { kind: "video", url: content } : undefined;
    case CanvasNodeType.Audio:
      return content ? { kind: "audio", url: content } : undefined;
    case CanvasNodeType.Text: {
      const text = content || node.metadata?.prompt;
      return text ? { kind: "text", text } : undefined;
    }
    default: {
      const value = getAtlasNodeDefinition(node.type)?.resource?.(node);
      return value
        ? { kind: value.kind, url: value.url, text: value.text }
        : undefined;
    }
  }
}

function addToIndex<K, V>(index: Map<K, V[]>, key: K, value: V) {
  const bucket = index.get(key);
  if (bucket) bucket.push(value);
  else index.set(key, [value]);
}

function uniqueNodes(items: readonly CanvasNodeData[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function resourceLabel(kind: CanvasResourceKind, index: number) {
  if (kind === "image") return imageReferenceLabel(index - 1);
  if (kind === "video")
    return `${i18n.t("canvas.configNode.videoReferences")} ${index}`;
  if (kind === "audio")
    return `${i18n.t("canvas.configNode.audioReferences")} ${index}`;
  return i18n.t("canvas.composer.resources.text", { index });
}

/** Immutable lookup snapshot for canvas resource, group, and mention queries. */
export class CanvasResourceIndex {
  private readonly nodesById = new Map<string, CanvasNodeData>();
  private readonly nodeOrder = new Map<string, number>();
  private readonly resourcesById = new Map<string, Resource>();
  private readonly membersByGroup = new Map<string, CanvasNodeData[]>();
  private readonly inputsByNode = new Map<string, string[]>();
  private readonly outputsByNode = new Map<string, string[]>();
  private readonly expandedGroups = new Map<string, CanvasNodeData[]>();
  private readonly mentionInputs = new Map<string, CanvasNodeData[]>();
  private readonly generationInputs = new Map<string, CanvasNodeData[]>();
  private readonly mentionLabels = new Map<string, CanvasResourceReference[]>();
  private allLabels?: CanvasResourceReference[];

  constructor(
    private readonly sourceNodes: readonly CanvasNodeData[],
    private readonly sourceConnections: readonly CanvasConnection[],
  ) {
    sourceNodes.forEach((node, order) => {
      // All indexes must agree on the same record when an old import has
      // duplicate IDs; a later duplicate must not replace only its resource.
      if (this.nodesById.has(node.id)) return;
      this.nodesById.set(node.id, node);
      this.nodeOrder.set(node.id, order);
      const parentId = node.metadata?.groupId;
      if (parentId) addToIndex(this.membersByGroup, parentId, node);
      const resource = mediaFor(node);
      if (resource) this.resourcesById.set(node.id, resource);
    });

    for (const connection of sourceConnections) {
      addToIndex(this.inputsByNode, connection.toNodeId, connection.fromNodeId);
      addToIndex(
        this.outputsByNode,
        connection.fromNodeId,
        connection.toNodeId,
      );
    }
  }

  matchesSnapshot(
    nodes: readonly CanvasNodeData[],
    connections: readonly CanvasConnection[],
  ) {
    return nodes === this.sourceNodes && connections === this.sourceConnections;
  }

  getNode(nodeId: string) {
    return this.nodesById.get(nodeId);
  }

  getMentionResourceNodes(nodeId: string) {
    const cached = this.mentionInputs.get(nodeId);
    if (cached) return cached;

    const explicit = this.configuredResources(nodeId);
    const sources = explicit.length
      ? explicit
      : this.connectedResources(nodeId);
    const result = sources.length
      ? this.expandGroupResources(sources)
      : this.ownResource(nodeId);
    this.mentionInputs.set(nodeId, result);
    return result;
  }

  getGenerationResourceNodes(nodeId: string) {
    const cached = this.generationInputs.get(nodeId);
    if (cached) return cached;
    const explicit = this.configuredResources(nodeId);
    const result = explicit.length ? explicit : this.connectedResources(nodeId);
    this.generationInputs.set(nodeId, result);
    return result;
  }

  buildNodeMentionReferences(nodeId: string) {
    let result = this.mentionLabels.get(nodeId);
    if (!result) {
      result = this.referencesFor(this.getMentionResourceNodes(nodeId));
      this.mentionLabels.set(nodeId, result);
    }
    return result;
  }

  buildCanvasResourceReferences() {
    this.allLabels ??= this.referencesFor(this.sourceNodes);
    return this.allLabels;
  }

  getGroupResourceNodes(groupId: string) {
    const cached = this.expandedGroups.get(groupId);
    if (cached) return cached;

    const pending = [groupId];
    const visitedGroups = new Set<string>();
    const resourceNodes = new Map<string, CanvasNodeData>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visitedGroups.has(current)) continue;
      visitedGroups.add(current);

      for (const child of this.membersByGroup.get(current) ?? []) {
        if (child.type === CanvasNodeType.Group) {
          pending.push(child.id);
        } else if (
          this.resourcesById.has(child.id) &&
          !resourceNodes.has(child.id)
        ) {
          resourceNodes.set(child.id, child);
        }
      }
    }

    const result = [...resourceNodes.values()].sort(
      (a, b) =>
        (this.nodeOrder.get(a.id) ?? 0) - (this.nodeOrder.get(b.id) ?? 0),
    );
    this.expandedGroups.set(groupId, result);
    return result;
  }

  isReferenceNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Group
      ? this.getGroupResourceNodes(node.id).length > 0
      : this.resourcesById.has(node.id);
  }

  private connectedResources(nodeId: string) {
    const candidates = (this.inputsByNode.get(nodeId) ?? [])
      .map((sourceId) => this.nodesById.get(sourceId))
      .filter((node): node is CanvasNodeData =>
        Boolean(node && this.isReferenceNode(node)),
      );
    return uniqueNodes(candidates);
  }

  private configuredResources(nodeId: string) {
    const configIds = this.outputsByNode.get(nodeId) ?? [];
    for (const configId of configIds) {
      if (this.nodesById.get(configId)?.type !== CanvasNodeType.Config)
        continue;
      const inputs = this.connectedResources(configId).filter(
        (node) => node.id !== nodeId,
      );
      if (inputs.length) return inputs;
    }
    return [];
  }

  private expandGroupResources(nodes: readonly CanvasNodeData[]) {
    const expanded: CanvasNodeData[] = [];
    for (const node of nodes) {
      if (node.type === CanvasNodeType.Group)
        expanded.push(...this.getGroupResourceNodes(node.id));
      else expanded.push(node);
    }
    return uniqueNodes(expanded);
  }

  private ownResource(nodeId: string) {
    const node = this.nodesById.get(nodeId);
    return node &&
      node.type !== CanvasNodeType.Group &&
      this.isReferenceNode(node)
      ? [node]
      : [];
  }

  private referencesFor(nodes: readonly CanvasNodeData[]) {
    const ordinals = new Map<CanvasResourceKind, number>();
    const references: CanvasResourceReference[] = [];
    for (const node of uniqueNodes(nodes)) {
      const resource = this.resourcesById.get(node.id);
      if (!resource) continue;
      const index = (ordinals.get(resource.kind) ?? 0) + 1;
      ordinals.set(resource.kind, index);
      const label = resourceLabel(resource.kind, index);
      references.push({
        id: node.id,
        nodeId: node.id,
        kind: resource.kind,
        label,
        title: node.title || label,
        previewUrl: node.metadata?.content || resource.url,
        text: resource.kind === "text" ? resource.text : undefined,
        active: true,
      });
    }
    return references;
  }
}

export function createCanvasResourceIndex(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[] = noConnections,
) {
  return new CanvasResourceIndex(nodes, connections);
}

export function buildNodeMentionReferences(
  node: CanvasNodeData,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
) {
  return createCanvasResourceIndex(
    nodes,
    connections,
  ).buildNodeMentionReferences(node.id);
}

export function buildCanvasResourceReferences(nodes: CanvasNodeData[]) {
  return createCanvasResourceIndex(nodes).buildCanvasResourceReferences();
}

export async function resolveCanvasReferenceImages(
  references: readonly CanvasResourceReference[],
  nodes: readonly CanvasNodeData[],
  options: { signal?: AbortSignal } = {},
): Promise<MediaReferenceImage[]> {
  throwIfAborted(options.signal);
  const byId = new Map<string, CanvasNodeData>();
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  const images = references.filter(({ kind }) => kind === "image");
  // Validate the whole selection before starting any disk/network work.
  const jobs = images.map((reference) => {
    const node = byId.get(reference.nodeId);
    if (!node)
      throw new Error(
        i18n.t("agent.composer.mentions.resourceMissing", {
          title: reference.title,
        }),
      );
    return { reference, node };
  });
  const results: MediaReferenceImage[] = new Array(jobs.length);
  let cursor = 0;
  let failed = false;
  const load = async () => {
    while (!failed && cursor < jobs.length) {
      throwIfAborted(options.signal);
      const slot = cursor++;
      const { reference, node } = jobs[slot];
      try {
        results[slot] = await loadReferenceImage(
          reference,
          node,
          options.signal,
        );
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  // A large selection should not decode every full-resolution image at once.
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, load));
  throwIfAborted(options.signal);
  return results;
}

async function loadReferenceImage(
  reference: CanvasResourceReference,
  node: CanvasNodeData,
  signal?: AbortSignal,
): Promise<MediaReferenceImage> {
  const metadata = node.metadata;
  const dataUrl = await imageToDataUrl(
    { storageKey: metadata?.storageKey, url: reference.previewUrl },
    { signal },
  );
  throwIfAborted(signal);
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error(
      i18n.t("agent.composer.mentions.imageReadFailed", {
        title: reference.title,
      }),
    );
  }
  const storedWidth = metadata?.naturalWidth;
  const storedHeight = metadata?.naturalHeight;
  const validStoredSize =
    typeof storedWidth === "number" &&
    Number.isFinite(storedWidth) &&
    storedWidth > 0 &&
    typeof storedHeight === "number" &&
    Number.isFinite(storedHeight) &&
    storedHeight > 0;
  const details = validStoredSize
    ? {
        width: storedWidth,
        height: storedHeight,
        mimeType: /^data:([^;,]+)/.exec(dataUrl)?.[1] || "image/png",
      }
    : await readImageMeta(dataUrl);
  throwIfAborted(signal);
  const storedBytes = metadata?.bytes;
  return {
    width: details.width,
    height: details.height,
    id: `canvas:${node.id}`,
    name: reference.title,
    type: metadata?.mimeType || details.mimeType,
    size:
      typeof storedBytes === "number" &&
      Number.isFinite(storedBytes) &&
      storedBytes >= 0
        ? storedBytes
        : getDataUrlByteSize(dataUrl),
    url: reference.previewUrl || dataUrl,
    dataUrl,
  };
}

export function getMentionResourceNodes(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
) {
  return createCanvasResourceIndex(nodes, connections).getMentionResourceNodes(
    nodeId,
  );
}

export function getGenerationResourceNodes(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
) {
  return createCanvasResourceIndex(
    nodes,
    connections,
  ).getGenerationResourceNodes(nodeId);
}

export function isCanvasReferenceNode(
  node: CanvasNodeData,
  nodes: CanvasNodeData[],
) {
  return createCanvasResourceIndex(nodes).isReferenceNode(node);
}

export function getGroupResourceNodes(
  groupId: string,
  nodes: CanvasNodeData[],
) {
  return createCanvasResourceIndex(nodes).getGroupResourceNodes(groupId);
}

export type CanvasResourceIndexApi = ReturnType<
  typeof createCanvasResourceIndex
>;
