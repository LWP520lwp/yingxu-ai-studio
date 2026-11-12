import type { CSSProperties } from "react";

export type AtlasPoint = Readonly<{ x: number; y: number }>;
export type AtlasViewport = Readonly<{ x: number; y: number; scale: number }>;
export type AtlasPort = "top" | "right" | "bottom" | "left";
export type AtlasNodeKind = "image" | "video" | "audio" | "text" | "config" | "group" | (string & {});

export type AtlasNode = Readonly<{
  id: string;
  kind: AtlasNodeKind;
  title: string;
  position: AtlasPoint;
  width: number;
  height: number;
  content?: string;
  status?: "idle" | "loading" | "success" | "error";
  color?: string;
}>;

export type AtlasEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  fromPort?: AtlasPort;
  toPort?: AtlasPort;
}>;

export type AtlasDocument = Readonly<{
  nodes: readonly AtlasNode[];
  edges: readonly AtlasEdge[];
  viewport: AtlasViewport;
}>;

export type AtlasSurfaceAction =
  | { type: "select-node"; nodeId: string; additive?: boolean }
  | { type: "select-edge"; edgeId: string }
  | { type: "clear-selection" }
  | { type: "set-viewport"; viewport: AtlasViewport }
  | { type: "connect"; edge: AtlasEdge }
  | { type: "disconnect"; edgeId: string }
  | { type: "move-node"; nodeId: string; position: AtlasPoint };

export type AtlasSurfaceSelection = Readonly<{
  nodeIds: readonly string[];
  edgeId?: string;
}>;

export const DEFAULT_ATLAS_VIEWPORT: AtlasViewport = { x: 0, y: 0, scale: 1 };

export function createAtlasDocument(
  nodes: readonly AtlasNode[] = [],
  edges: readonly AtlasEdge[] = [],
  viewport: AtlasViewport = DEFAULT_ATLAS_VIEWPORT,
): AtlasDocument {
  return { nodes: [...nodes], edges: [...edges], viewport: { ...viewport } };
}

export function createAtlasSelection(): AtlasSurfaceSelection {
  return { nodeIds: [] };
}

export function reduceAtlasSelection(
  selection: AtlasSurfaceSelection,
  action: Extract<AtlasSurfaceAction, { type: "select-node" | "select-edge" | "clear-selection" }>,
): AtlasSurfaceSelection {
  if (action.type === "clear-selection") return createAtlasSelection();
  if (action.type === "select-edge") return { nodeIds: [], edgeId: action.edgeId };
  const nodeIds = action.additive
    ? selection.nodeIds.includes(action.nodeId)
      ? selection.nodeIds.filter((id) => id !== action.nodeId)
      : [...selection.nodeIds, action.nodeId]
    : [action.nodeId];
  return { nodeIds };
}

export function reduceAtlasDocument(
  document: AtlasDocument,
  action: Exclude<AtlasSurfaceAction, { type: "select-node" | "select-edge" | "clear-selection" }>,
): AtlasDocument {
  switch (action.type) {
    case "set-viewport":
      return { ...document, viewport: { ...action.viewport } };
    case "move-node":
      return {
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === action.nodeId ? { ...node, position: { ...action.position } } : node,
        ),
      };
    case "connect":
      if (action.edge.from === action.edge.to || document.edges.some((edge) => edge.id === action.edge.id)) {
        return document;
      }
      return { ...document, edges: [...document.edges, { ...action.edge }] };
    case "disconnect":
      return { ...document, edges: document.edges.filter((edge) => edge.id !== action.edgeId) };
  }
}

export function nodeStyle(node: AtlasNode, selected: boolean, scale: number): CSSProperties {
  return {
    position: "absolute",
    left: node.position.x,
    top: node.position.y,
    width: node.width,
    height: node.height,
    zIndex: selected ? 20 : 10,
    borderColor: selected ? "var(--atlas-accent, #4f8cff)" : "var(--atlas-node-border, #334155)",
    boxShadow: selected ? "0 0 0 2px color-mix(in srgb, var(--atlas-accent, #4f8cff) 26%, transparent)" : undefined,
    transformOrigin: "top left",
    willChange: scale < 0.7 ? "transform" : undefined,
  };
}
