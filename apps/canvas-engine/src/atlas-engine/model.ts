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
export const ATLAS_ZOOM_LIMITS = { min: 0.1, max: 4 } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}不能为空`);
  }
}

export function cloneAtlasData(
  data: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!data) return undefined;
  try {
    return typeof globalThis.structuredClone === "function"
      ? globalThis.structuredClone(data)
      : { ...data };
  } catch {
    return { ...data };
  }
}

function cloneNode(node: AtlasNode): AtlasNode {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    frame: { ...node.frame },
    ...(node.data ? { data: cloneAtlasData(node.data) } : {}),
  };
}

function assertNode(node: AtlasNode): void {
  if (!isRecord(node)) throw new Error("节点格式无效");
  requireIdentifier(node.id, "节点标识");
  requireIdentifier(node.kind, `节点“${node.id}”类型`);
  if (typeof node.title !== "string") throw new Error(`节点“${node.id}”标题无效`);
  if (!isRecord(node.frame)) throw new Error(`节点“${node.id}”尺寸无效`);
  if (
    !finite(node.frame.x) ||
    !finite(node.frame.y) ||
    !finite(node.frame.width) ||
    !finite(node.frame.height) ||
    node.frame.width < 0 ||
    node.frame.height < 0
  ) {
    throw new Error(`节点“${node.id}”坐标或尺寸无效`);
  }
  if (node.data !== undefined && !isRecord(node.data)) {
    throw new Error(`节点“${node.id}”数据必须是对象`);
  }
}

function assertEdge(edge: AtlasEdge): void {
  if (!isRecord(edge)) throw new Error("连线格式无效");
  requireIdentifier(edge.id, "连线标识");
  requireIdentifier(edge.source, `连线“${edge.id}”起点`);
  requireIdentifier(edge.target, `连线“${edge.id}”终点`);
  if (edge.source === edge.target) throw new Error(`连线“${edge.id}”不能连接自身`);
}

export function createAtlasDocument(
  input: Partial<Pick<AtlasDocument, "nodes" | "edges" | "viewport" | "selection">> = {},
): AtlasDocument {
  const sourceNodes: unknown = input.nodes ?? [];
  const sourceEdges: unknown = input.edges ?? [];
  if (!Array.isArray(sourceNodes) || !Array.isArray(sourceEdges)) {
    throw new Error("画布节点和连线必须是数组");
  }
  const nodes = (sourceNodes as AtlasNode[]).map((node) => {
    assertNode(node);
    return cloneNode(node);
  });
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(`节点标识“${node.id}”重复`);
    nodeIds.add(node.id);
  }

  const edges = (sourceEdges as AtlasEdge[]).map((edge) => {
    assertEdge(edge);
    return { ...edge };
  });
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`连线“${edge.id}”引用了不存在的节点`);
    }
    const pair = JSON.stringify([edge.source, edge.target]);
    if (edgeIds.has(edge.id) || pairs.has(pair)) {
      throw new Error(`连线“${edge.id}”重复`);
    }
    edgeIds.add(edge.id);
    pairs.add(pair);
  }

  const viewportInput: unknown = input.viewport ?? DEFAULT_ATLAS_VIEWPORT;
  const viewport = isRecord(viewportInput) ? viewportInput : DEFAULT_ATLAS_VIEWPORT;
  const safeViewport = {
    x: finite(viewport.x) ? viewport.x : DEFAULT_ATLAS_VIEWPORT.x,
    y: finite(viewport.y) ? viewport.y : DEFAULT_ATLAS_VIEWPORT.y,
    zoom: Math.min(
      ATLAS_ZOOM_LIMITS.max,
      Math.max(
        ATLAS_ZOOM_LIMITS.min,
        finite(viewport.zoom) ? viewport.zoom : DEFAULT_ATLAS_VIEWPORT.zoom,
      ),
    ),
  };

  const selectionInput: unknown = input.selection ?? { nodeIds: [] };
  if (!isRecord(selectionInput) || !Array.isArray(selectionInput.nodeIds)) {
    throw new Error("画布选择状态无效");
  }
  if (selectionInput.edgeId !== undefined && typeof selectionInput.edgeId !== "string") {
    throw new Error("选中的连线标识无效");
  }
  const selectedNodeIds = [...new Set(selectionInput.nodeIds.filter(
    (id): id is string => typeof id === "string" && nodeIds.has(id),
  ))];
  const selectedEdgeId = edgeIds.has(selectionInput.edgeId ?? "")
    ? selectionInput.edgeId as string
    : undefined;

  return {
    nodes,
    edges,
    viewport: safeViewport,
    selection: {
      nodeIds: selectedNodeIds,
      ...(selectedEdgeId ? { edgeId: selectedEdgeId } : {}),
    },
    revision: 0,
  };
}

export function isValidAtlasNode(value: unknown): value is AtlasNode {
  try {
    assertNode(value as AtlasNode);
    return true;
  } catch {
    return false;
  }
}

export function nodeRect(node: AtlasNode): AtlasRect {
  return {
    x: finite(node.frame.x) ? node.frame.x : 0,
    y: finite(node.frame.y) ? node.frame.y : 0,
    width: Math.max(0, finite(node.frame.width) ? node.frame.width : 0),
    height: Math.max(0, finite(node.frame.height) ? node.frame.height : 0),
  };
}
