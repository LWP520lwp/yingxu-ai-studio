import type {
  CanvasConnection,
  CanvasNodeData,
  Position,
  ViewportTransform,
} from "@/types/canvas";
import type { AtlasDocument, AtlasEdge, AtlasNode, AtlasSelection, AtlasViewport } from "./model";
import { cloneAtlasData, createAtlasDocument } from "./model";
import { applyAtlasCommands } from "./reducer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeNodes(nodes: readonly CanvasNodeData[]): AtlasNode[] {
  const result: AtlasNode[] = [];
  const ids = new Set<string>();
  for (const source of nodes) {
    const node = canvasNodeToAtlasNode(source);
    if (!node || ids.has(node.id)) continue;
    ids.add(node.id);
    result.push(node);
  }
  return result;
}

function canvasNodeToAtlasNode(source: CanvasNodeData): AtlasNode | null {
  const node = source as unknown as Record<string, unknown> | null;
  if (!node || typeof node.id !== "string" || !node.id.trim() ||
      typeof node.type !== "string" || !node.type.trim()) return null;
  const position = node.position;
  if (!isRecord(position)) return null;
  return {
    id: node.id,
    kind: node.type,
    title: typeof node.title === "string" ? node.title : "",
    frame: {
      x: finite(position.x) ? position.x : 0,
      y: finite(position.y) ? position.y : 0,
      width: finite(node.width) ? Math.max(0, node.width) : 0,
      height: finite(node.height) ? Math.max(0, node.height) : 0,
    },
    data: isRecord(node.metadata) ? { ...node.metadata } : {},
  };
}

function normalizeEdges(
  connections: readonly CanvasConnection[],
  nodes: readonly AtlasNode[],
): AtlasEdge[] {
  const result: AtlasEdge[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const source of connections) {
    const edge = source as unknown as Record<string, unknown> | null;
    if (!edge || typeof edge.id !== "string" || !edge.id.trim() ||
        typeof edge.fromNodeId !== "string" || typeof edge.toNodeId !== "string") continue;
    const { id, fromNodeId: sourceId, toNodeId: targetId } = edge;
    const pair = JSON.stringify([sourceId, targetId]);
    if (edgeIds.has(id) || sourceId === targetId || !nodeIds.has(sourceId) ||
        !nodeIds.has(targetId) || pairs.has(pair)) continue;
    edgeIds.add(id);
    pairs.add(pair);
    result.push({ id, source: sourceId, target: targetId });
  }
  return result;
}

function canvasViewport(viewport: ViewportTransform): AtlasViewport {
  const value = viewport as unknown as Record<string, unknown> | null;
  return {
    x: finite(value?.x) ? value.x : 0,
    y: finite(value?.y) ? value.y : 0,
    zoom: finite(value?.k) ? value.k : 1,
  };
}

function normalizedSelection(
  selection: AtlasSelection | undefined,
  nodes: readonly AtlasNode[],
  edges: readonly AtlasEdge[],
): AtlasSelection {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const selected = selection?.nodeIds ?? [];
  const selectedEdge = selection?.edgeId;
  return {
    nodeIds: [...new Set(selected)].filter((id) => nodeIds.has(id)),
    ...(selectedEdge && edgeIds.has(selectedEdge) ? { edgeId: selectedEdge } : {}),
  };
}

export function fromCanvasDocument(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
  viewport: ViewportTransform,
  selection?: AtlasSelection,
): AtlasDocument {
  const atlasNodes = normalizeNodes(nodes);
  const edges = normalizeEdges(connections, atlasNodes);
  return createAtlasDocument({
    nodes: atlasNodes,
    edges,
    viewport: canvasViewport(viewport),
    selection: normalizedSelection(selection, atlasNodes, edges),
  });
}

/** Replaces the canvas projection through Atlas commands while keeping revisions monotonic. */
export function replaceAtlasCanvasDocument(
  current: AtlasDocument,
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
  viewport: ViewportTransform,
  selection: AtlasSelection = current.selection,
): AtlasDocument {
  const atlasNodes = normalizeNodes(nodes);
  const edges = normalizeEdges(connections, atlasNodes);
  return applyAtlasCommands(current, [
    {
      type: "replace-elements",
      nodes: atlasNodes,
      edges,
      viewport: canvasViewport(viewport),
      selection: normalizedSelection(selection, atlasNodes, edges),
    },
  ]);
}

const canvasNodeCache = new WeakMap<AtlasNode, CanvasNodeData>();
const atlasNodeCache = new WeakMap<CanvasNodeData, AtlasNode>();

function matchesCanvasNode(node: AtlasNode, projected: CanvasNodeData, source: CanvasNodeData) {
  return source.type === projected.type &&
    source.title === projected.title &&
    source.position?.x === projected.position.x &&
    source.position?.y === projected.position.y &&
    source.width === projected.width &&
    source.height === projected.height &&
    source.metadata === projected.metadata &&
    node.id === source.id;
}

export function reconcileAtlasCanvasNodes(
  document: AtlasDocument,
  sources: readonly CanvasNodeData[],
): AtlasDocument {
  const existing = new Map(document.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const nodes: AtlasNode[] = [];
  for (const source of sources) {
    const cached = atlasNodeCache.get(source);
    const id = cached?.id ?? source.id;
    if (seen.has(id)) continue;
    seen.add(id);
    if (cached && existing.get(id) === cached) {
      nodes.push(cached);
      continue;
    }
    const previous = existing.get(id);
    const projected = previous ? canvasNodeCache.get(previous) : undefined;
    if (previous && projected && matchesCanvasNode(previous, projected, source)) {
      nodes.push(previous);
      atlasNodeCache.set(source, previous);
      continue;
    }
    const normalized = canvasNodeToAtlasNode(source);
    if (normalized) nodes.push(normalized);
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  return applyAtlasCommands(document, [{
    type: "replace-elements",
    nodes,
    edges: document.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  }]);
}

export function toCanvasNodes(document: AtlasDocument): CanvasNodeData[] {
  return document.nodes.map((node) => {
    const cached = canvasNodeCache.get(node);
    if (cached) return cached;
    const projected: CanvasNodeData = {
      id: node.id,
      type: node.kind,
      title: node.title,
      position: { x: node.frame.x, y: node.frame.y },
      width: node.frame.width,
      height: node.frame.height,
      metadata: cloneAtlasData(node.data) as CanvasNodeData["metadata"],
    };
    canvasNodeCache.set(node, projected);
    atlasNodeCache.set(projected, node);
    return projected;
  });
}

const canvasEdgeCache = new WeakMap<AtlasEdge, CanvasConnection>();

export function toCanvasConnections(document: AtlasDocument): CanvasConnection[] {
  return document.edges.map((edge) => {
    const cached = canvasEdgeCache.get(edge);
    if (cached) return cached;
    const projected = { id: edge.id, fromNodeId: edge.source, toNodeId: edge.target };
    canvasEdgeCache.set(edge, projected);
    return projected;
  });
}

export function toCanvasViewport(viewport: AtlasViewport): ViewportTransform {
  return { x: viewport.x, y: viewport.y, k: viewport.zoom };
}

export function canvasPosition(point: AtlasNode["frame"]): Position {
  return { x: point.x, y: point.y };
}
