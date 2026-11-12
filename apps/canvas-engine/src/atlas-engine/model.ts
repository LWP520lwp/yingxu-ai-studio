export type AtlasPoint = Readonly<{ x: number; y: number }>;

export type AtlasRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type AtlasViewport = Readonly<{
  x: number;
  y: number;
  zoom: number;
}>;

export type AtlasNode = Readonly<{
  id: string;
  kind: string;
  title: string;
  frame: AtlasRect;
  data?: Readonly<Record<string, unknown>>;
}>;

export type AtlasEdge = Readonly<{
  id: string;
  source: string;
  target: string;
}>;

export type AtlasSelection = Readonly<{
  nodeIds: readonly string[];
  edgeId?: string;
}>;

export type AtlasDocument = Readonly<{
  nodes: readonly AtlasNode[];
  edges: readonly AtlasEdge[];
  viewport: AtlasViewport;
  selection: AtlasSelection;
  revision: number;
}>;

export const DEFAULT_ATLAS_VIEWPORT: AtlasViewport = { x: 0, y: 0, zoom: 1 };

export function createAtlasDocument(
  input: Partial<Pick<AtlasDocument, "nodes" | "edges" | "viewport" | "selection">> = {},
): AtlasDocument {
  return {
    nodes: [...(input.nodes ?? [])],
    edges: [...(input.edges ?? [])],
    viewport: { ...DEFAULT_ATLAS_VIEWPORT, ...(input.viewport ?? {}) },
    selection: {
      nodeIds: [...(input.selection?.nodeIds ?? [])],
      ...(input.selection?.edgeId ? { edgeId: input.selection.edgeId } : {}),
    },
    revision: 0,
  };
}

export function nodeRect(node: AtlasNode): AtlasRect {
  return {
    x: Number.isFinite(node.frame.x) ? node.frame.x : 0,
    y: Number.isFinite(node.frame.y) ? node.frame.y : 0,
    width: Math.max(0, Number.isFinite(node.frame.width) ? node.frame.width : 0),
    height: Math.max(0, Number.isFinite(node.frame.height) ? node.frame.height : 0),
  };
}
