import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasProject } from "@/lib/canvas/canvas-project-catalog";
import { assertProductDocument, type ProductDocument } from "./document";

export function fromStoredCanvas(project: CanvasProject): ProductDocument {
  const document: ProductDocument = {
    schemaVersion: 1,
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    nodes: project.nodes.map((node) => ({
      id: node.id,
      kind: node.type,
      title: node.title,
      frame: {
        x: node.position.x,
        y: node.position.y,
        width: node.width,
        height: node.height,
      },
      data: { ...(node.metadata ?? {}) },
    })),
    edges: project.connections.map((edge) => ({
      id: edge.id,
      from: edge.fromNodeId,
      to: edge.toNodeId,
    })),
    viewport: {
      x: project.viewport.x,
      y: project.viewport.y,
      scale: project.viewport.k,
    },
    chatSessions: structuredClone(project.chatSessions),
    activeChatId: project.activeChatId,
    backgroundMode: project.backgroundMode,
    showImageInfo: project.showImageInfo,
  };
  assertProductDocument(document);
  return document;
}

export function toStoredCanvas(
  base: CanvasProject,
  document: ProductDocument,
): CanvasProject {
  assertProductDocument(document);
  if (base.id !== document.id) throw new Error("画布项目 ID 不匹配");
  const nodes: CanvasNodeData[] = document.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    title: node.title,
    position: { x: node.frame.x, y: node.frame.y },
    width: node.frame.width,
    height: node.frame.height,
    metadata: { ...node.data },
  }));
  return {
    ...base,
    title: document.title,
    createdAt: document.createdAt || base.createdAt,
    updatedAt: document.updatedAt || base.updatedAt,
    nodes,
    connections: document.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
    })),
    viewport: {
      x: document.viewport.x,
      y: document.viewport.y,
      k: document.viewport.scale,
    },
    chatSessions: structuredClone(document.chatSessions) as CanvasProject["chatSessions"],
    activeChatId: document.activeChatId,
    backgroundMode: document.backgroundMode,
    showImageInfo: document.showImageInfo,
  };
}
