import type { CanvasConnection, CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";
import type { AtlasDocument, AtlasEdge, AtlasNode, AtlasViewport } from "./model";
import { createAtlasDocument } from "./model";

function metadataRecord(node: CanvasNodeData): Record<string, unknown> {
  return { ...(node.metadata ?? {}) };
}

export function fromCanvasDocument(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
  viewport: ViewportTransform,
): AtlasDocument {
  const atlasNodes: AtlasNode[] = nodes.map((node) => ({
    id: node.id,
    kind: node.type,
    title: node.title,
    frame: { x: node.position.x, y: node.position.y, width: node.width, height: node.height },
    data: metadataRecord(node),
  }));
  const edges: AtlasEdge[] = connections.map((edge) => ({ id: edge.id, source: edge.fromNodeId, target: edge.toNodeId }));
  const atlasViewport: AtlasViewport = { x: viewport.x, y: viewport.y, zoom: viewport.k };
  return createAtlasDocument({ nodes: atlasNodes, edges, viewport: atlasViewport });
}

export function toCanvasNodes(document: AtlasDocument): CanvasNodeData[] {
  return document.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    title: node.title,
    position: { x: node.frame.x, y: node.frame.y },
    width: node.frame.width,
    height: node.frame.height,
    metadata: { ...(node.data ?? {}) } as CanvasNodeData["metadata"],
  }));
}

export function toCanvasConnections(document: AtlasDocument): CanvasConnection[] {
  return document.edges.map((edge) => ({ id: edge.id, fromNodeId: edge.source, toNodeId: edge.target }));
}

export function toCanvasViewport(viewport: AtlasViewport): ViewportTransform {
  return { x: viewport.x, y: viewport.y, k: viewport.zoom };
}

export function canvasPosition(point: AtlasNode["frame"]): Position {
  return { x: point.x, y: point.y };
}
