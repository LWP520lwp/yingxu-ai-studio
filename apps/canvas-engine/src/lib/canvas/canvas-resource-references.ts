import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import i18n from "@/i18n";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

type ResourceValue = { kind: CanvasResourceKind; url?: string; text?: string };
type ResourceGraph = {
    nodeById: Map<string, CanvasNodeData>;
    nodeOrder: Map<string, number>;
    childrenByGroup: Map<string, CanvasNodeData[]>;
    resourceByNode: Map<string, ResourceValue>;
    incoming: Map<string, string[]>;
    outgoing: Map<string, string[]>;
    groupResources: Map<string, CanvasNodeData[]>;
};

function indexResources(nodes: readonly CanvasNodeData[], connections: readonly CanvasConnection[]): ResourceGraph {
    const nodeById = new Map<string, CanvasNodeData>();
    const nodeOrder = new Map<string, number>();
    const childrenByGroup = new Map<string, CanvasNodeData[]>();
    const resourceByNode = new Map<string, ResourceValue>();

    for (const [index, node] of nodes.entries()) {
        nodeById.set(node.id, node);
        if (!nodeOrder.has(node.id)) nodeOrder.set(node.id, index);

        const parentId = node.metadata?.groupId;
        if (parentId) {
            const children = childrenByGroup.get(parentId);
            if (children) children.push(node);
            else childrenByGroup.set(parentId, [node]);
        }

        const resource = readResourceValue(node);
        if (resource) resourceByNode.set(node.id, resource);
    }

    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const edge of connections) {
        const sources = incoming.get(edge.toNodeId);
        if (sources) sources.push(edge.fromNodeId);
        else incoming.set(edge.toNodeId, [edge.fromNodeId]);
        const targets = outgoing.get(edge.fromNodeId);
        if (targets) targets.push(edge.toNodeId);
        else outgoing.set(edge.fromNodeId, [edge.toNodeId]);
    }
    return { nodeById, nodeOrder, childrenByGroup, resourceByNode, incoming, outgoing, groupResources: new Map() };
}

function readResourceValue(node: CanvasNodeData): ResourceValue | undefined {
    const content = node.metadata?.content;
    if (node.type === CanvasNodeType.Image && content) return { kind: "image", url: content };
    if (node.type === CanvasNodeType.Video && content) return { kind: "video", url: content };
    if (node.type === CanvasNodeType.Audio && content) return { kind: "audio", url: content };
    if (node.type === CanvasNodeType.Text && (content || node.metadata?.prompt)) {
        return { kind: "text", text: content || node.metadata?.prompt };
    }

    const pluginResource = getNodeDefinition(node.type)?.resource?.(node);
    return pluginResource ? { kind: pluginResource.kind, url: pluginResource.url, text: pluginResource.text } : undefined;
}

function collectGroupResources(groupId: string, graph: ResourceGraph) {
    const cached = graph.groupResources.get(groupId);
    if (cached) return cached;
    const result: CanvasNodeData[] = [];
    const includedNodeIds = new Set<string>();
    const visitedGroupIds = new Set<string>();

    const pending = [groupId];
    while (pending.length) {
        const currentGroupId = pending.pop()!;
        if (visitedGroupIds.has(currentGroupId)) continue;
        visitedGroupIds.add(currentGroupId);

        for (const child of graph.childrenByGroup.get(currentGroupId) || []) {
            if (child.type === CanvasNodeType.Group) {
                pending.push(child.id);
                continue;
            }
            if (!graph.resourceByNode.has(child.id) || includedNodeIds.has(child.id)) continue;
            includedNodeIds.add(child.id);
            result.push(child);
        }
    }
    result.sort((left, right) => graph.nodeOrder.get(left.id)! - graph.nodeOrder.get(right.id)!);
    graph.groupResources.set(groupId, result);
    return result;
}

function isReferenceNode(node: CanvasNodeData, graph: ResourceGraph) {
    if (node.type === CanvasNodeType.Group) return collectGroupResources(node.id, graph).length > 0;
    return graph.resourceByNode.has(node.id);
}

function uniqueNodes(nodes: CanvasNodeData[]) {
    const seen = new Set<string>();
    return nodes.filter((node) => {
        if (seen.has(node.id)) return false;
        seen.add(node.id);
        return true;
    });
}

function connectedReferenceNodes(targetId: string, graph: ResourceGraph) {
    const sources: CanvasNodeData[] = [];
    for (const sourceId of graph.incoming.get(targetId) || []) {
        const source = graph.nodeById.get(sourceId);
        if (source && isReferenceNode(source, graph)) sources.push(source);
    }
    return uniqueNodes(sources);
}

function connectedConfigReferences(nodeId: string, graph: ResourceGraph) {
    for (const targetId of graph.outgoing.get(nodeId) || []) {
        const config = graph.nodeById.get(targetId);
        if (!config || config.type !== CanvasNodeType.Config) continue;
        return connectedReferenceNodes(config.id, graph).filter((source) => source.id !== nodeId);
    }
    return [];
}

function expandGroups(nodes: CanvasNodeData[], graph: ResourceGraph) {
    const expanded: CanvasNodeData[] = [];
    for (const node of nodes) {
        if (node.type === CanvasNodeType.Group) expanded.push(...collectGroupResources(node.id, graph));
        else expanded.push(node);
    }
    return uniqueNodes(expanded);
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return createCanvasResourceIndex(nodes, connections).buildNodeMentionReferences(node.id);
}

export function buildCanvasResourceReferences(nodes: CanvasNodeData[]) {
    return createCanvasResourceIndex(nodes).buildCanvasResourceReferences();
}

/** Reuse one immutable graph snapshot across every panel/reference lookup. */
export function createCanvasResourceIndex(nodes: readonly CanvasNodeData[], connections: readonly CanvasConnection[] = []) {
    const graph = indexResources(nodes, connections);
    const mentionNodes = new Map<string, CanvasNodeData[]>();
    const generationNodes = new Map<string, CanvasNodeData[]>();
    const references = new Map<string, CanvasResourceReference[]>();
    let allReferences: CanvasResourceReference[] | undefined;
    const getMentionNodes = (nodeId: string) => {
        let result = mentionNodes.get(nodeId);
        if (!result) {
            result = getMentionResourceNodesFromGraph(nodeId, graph);
            mentionNodes.set(nodeId, result);
        }
        return result;
    };
    return {
        matchesSnapshot: (candidateNodes: readonly CanvasNodeData[], candidateConnections: readonly CanvasConnection[]) =>
            candidateNodes === nodes && candidateConnections === connections,
        getNode: (nodeId: string) => graph.nodeById.get(nodeId),
        getMentionResourceNodes: getMentionNodes,
        getGenerationResourceNodes: (nodeId: string) => {
            let result = generationNodes.get(nodeId);
            if (!result) {
                const configured = connectedConfigReferences(nodeId, graph);
                result = configured.length ? configured : connectedReferenceNodes(nodeId, graph);
                generationNodes.set(nodeId, result);
            }
            return result;
        },
        buildNodeMentionReferences: (nodeId: string) => {
            let result = references.get(nodeId);
            if (!result) {
                result = labelResourceNodes(getMentionNodes(nodeId), graph, true);
                references.set(nodeId, result);
            }
            return result;
        },
        buildCanvasResourceReferences: () => allReferences ??= labelResourceNodes([...nodes], graph, true),
        getGroupResourceNodes: (groupId: string) => collectGroupResources(groupId, graph),
        isReferenceNode: (node: CanvasNodeData) => isReferenceNode(node, graph),
    };
}

export type CanvasResourceIndex = ReturnType<typeof createCanvasResourceIndex>;

export async function resolveCanvasReferenceImages(references: CanvasResourceReference[], nodes: CanvasNodeData[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return Promise.all(references.filter((reference) => reference.kind === "image").map(async (reference) => {
        const node = nodesById.get(reference.nodeId);
        if (!node) throw new Error(i18n.t("agent.composer.mentions.resourceMissing", { title: reference.title }));
        const metadata = node.metadata;
        const dataUrl = await imageToDataUrl({ storageKey: metadata?.storageKey, url: reference.previewUrl });
        if (!dataUrl.startsWith("data:image/")) throw new Error(i18n.t("agent.composer.mentions.imageReadFailed", { title: reference.title }));
        const meta = metadata?.naturalWidth && metadata.naturalHeight
            ? { width: metadata.naturalWidth, height: metadata.naturalHeight, mimeType: metadata.mimeType || dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png" }
            : await readImageMeta(dataUrl);
        return {
            id: `canvas:${node.id}`,
            name: reference.title,
            type: metadata?.mimeType || meta.mimeType,
            size: metadata?.bytes || getDataUrlByteSize(dataUrl),
            width: meta.width,
            height: meta.height,
            url: reference.previewUrl || dataUrl,
            dataUrl,
        };
    }));
}

function getMentionResourceNodesFromGraph(nodeId: string, graph: ResourceGraph) {
    const configuredInputs = connectedConfigReferences(nodeId, graph);
    if (configuredInputs.length) return expandGroups(configuredInputs, graph);

    const directInputs = connectedReferenceNodes(nodeId, graph);
    if (directInputs.length) return expandGroups(directInputs, graph);

    const node = graph.nodeById.get(nodeId);
    return node && node.type !== CanvasNodeType.Group && isReferenceNode(node, graph) ? [node] : [];
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return createCanvasResourceIndex(nodes, connections).getMentionResourceNodes(nodeId);
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return createCanvasResourceIndex(nodes, connections).getGenerationResourceNodes(nodeId);
}

export function isCanvasReferenceNode(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return createCanvasResourceIndex(nodes).isReferenceNode(node);
}

export function getGroupResourceNodes(groupId: string, nodes: CanvasNodeData[]) {
    return createCanvasResourceIndex(nodes).getGroupResourceNodes(groupId);
}

function labelResourceNodes(nodes: CanvasNodeData[], graph: ResourceGraph, active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    const references: CanvasResourceReference[] = [];

    for (const node of uniqueNodes(nodes)) {
        const resource = graph.resourceByNode.get(node.id);
        if (!resource) continue;
        const index = counts[resource.kind]++;
        const label = labelForKind(resource.kind, index);
        references.push({
            id: node.id,
            nodeId: node.id,
            kind: resource.kind,
            label,
            title: node.title || label,
            previewUrl: node.metadata?.content || resource.url,
            text: resource.kind === "text" ? resource.text : undefined,
            active,
        });
    }

    return references;
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return i18n.t("canvas.configNode.videoReferences") + ` ${index + 1}`;
    if (kind === "audio") return i18n.t("canvas.configNode.audioReferences") + ` ${index + 1}`;
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}
