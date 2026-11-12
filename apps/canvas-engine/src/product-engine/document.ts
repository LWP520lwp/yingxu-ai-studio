export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type ProductNode = {
  id: string;
  kind: string;
  title: string;
  frame: Rect;
  data: Record<string, unknown>;
};
export type ProductEdge = {
  id: string;
  from: string;
  to: string;
};
export type ProductViewport = { x: number; y: number; scale: number };
export type ProductDocument = {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: ProductNode[];
  edges: ProductEdge[];
  viewport: ProductViewport;
  chatSessions: unknown[];
  activeChatId: string | null;
  backgroundMode: "dots" | "lines" | "blank";
  showImageInfo: boolean;
};

export type ProductCommand =
  | { type: "node.add"; node: ProductNode }
  | { type: "node.move"; positions: Array<{ id: string } & Point> }
  | { type: "node.resize"; id: string; width: number; height: number }
  | { type: "node.remove"; ids: string[] }
  | { type: "edge.connect"; edge: ProductEdge }
  | { type: "edge.remove"; id: string }
  | { type: "viewport.set"; viewport: ProductViewport };

const MAX_NODES = 1500;
const MAX_EDGES = 6000;
const MAX_DIMENSION = 8192;
const MIN_DIMENSION = 48;
const MIN_SCALE = 0.05;
const MAX_SCALE = 5;
const MAX_WORLD_COORDINATE = 10_000_000;
const MAX_VIEWPORT_OFFSET = 100_000_000;
const MAX_TITLE_LENGTH = 256;
const MAX_KIND_LENGTH = 128;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

export function createProductDocument(
  id: string,
  title: string,
): ProductDocument {
  if (!validId(id)) throw new Error("画布 ID 无效");
  if (typeof title !== "string" || title.length > MAX_TITLE_LENGTH) {
    throw new Error("画布名称无效");
  }
  return {
    schemaVersion: 1,
    id,
    title,
    createdAt: "",
    updatedAt: "",
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, scale: 1 },
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines",
    showImageInfo: false,
  };
}

export function validateProductDocument(value: unknown): string[] {
  if (!isRecord(value)) return ["画布文档必须是对象"];
  if (value.schemaVersion !== 1) return ["不支持的画布文档版本"];
  if (
    !validId(value.id) ||
    typeof value.title !== "string" ||
    value.title.length > MAX_TITLE_LENGTH ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  )
    return ["画布身份信息无效"];
  if (
    !Array.isArray(value.chatSessions) ||
    !(value.activeChatId === null || typeof value.activeChatId === "string") ||
    !["dots", "lines", "blank"].includes(String(value.backgroundMode)) ||
    typeof value.showImageInfo !== "boolean"
  )
    return ["画布偏好或会话数据无效"];
  if (!Array.isArray(value.nodes) || value.nodes.length > MAX_NODES)
    return ["画布节点数量无效"];
  if (!Array.isArray(value.edges) || value.edges.length > MAX_EDGES)
    return ["画布连线数量无效"];
  if (
    !isRecord(value.viewport) ||
    !finite(value.viewport.x) ||
    !finite(value.viewport.y) ||
    !finite(value.viewport.scale) ||
    value.viewport.scale < MIN_SCALE ||
    value.viewport.scale > MAX_SCALE ||
    Math.abs(value.viewport.x) > MAX_VIEWPORT_OFFSET ||
    Math.abs(value.viewport.y) > MAX_VIEWPORT_OFFSET
  )
    return ["画布视口无效"];

  const nodeIds = new Set<string>();
  for (const candidate of value.nodes) {
    if (
      !isRecord(candidate) ||
      !validId(candidate.id) ||
      typeof candidate.kind !== "string" ||
      !candidate.kind ||
      candidate.kind.length > MAX_KIND_LENGTH ||
      typeof candidate.title !== "string" ||
      !isRecord(candidate.data) ||
      !isRecord(candidate.frame)
    )
      return ["画布包含无效节点"];
    const { x, y, width, height } = candidate.frame;
    if (
      !finite(x) ||
      !finite(y) ||
      Math.abs(x) > MAX_WORLD_COORDINATE ||
      Math.abs(y) > MAX_WORLD_COORDINATE ||
      !finite(width) ||
      !finite(height) ||
      width < MIN_DIMENSION ||
      height < MIN_DIMENSION ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION
    )
      return ["画布节点尺寸或位置无效"];
    if (nodeIds.has(candidate.id)) return ["画布节点 ID 重复"];
    nodeIds.add(candidate.id);
  }

  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const candidate of value.edges) {
    if (
      !isRecord(candidate) ||
      !validId(candidate.id) ||
      !validId(candidate.from) ||
      !validId(candidate.to) ||
      candidate.from === candidate.to ||
      !nodeIds.has(candidate.from) ||
      !nodeIds.has(candidate.to)
    )
      return ["画布包含无效连线"];
    const pair = `${candidate.from}\u0000${candidate.to}`;
    if (edgeIds.has(candidate.id) || pairs.has(pair)) return ["画布连线重复"];
    edgeIds.add(candidate.id);
    pairs.add(pair);
  }

  return [];
}

export function assertProductDocument(
  value: unknown,
): asserts value is ProductDocument {
  const issues = validateProductDocument(value);
  if (issues.length) throw new Error(issues[0]);
}

function assertPoint(value: Point): void {
  if (
    !finite(value.x) ||
    !finite(value.y) ||
    Math.abs(value.x) > MAX_WORLD_COORDINATE ||
    Math.abs(value.y) > MAX_WORLD_COORDINATE
  ) {
    throw new Error("节点位置超出允许范围");
  }
}

export function applyProductCommand(
  document: ProductDocument,
  command: ProductCommand,
): ProductDocument {
  assertProductDocument(document);
  let next: ProductDocument;
  switch (command.type) {
    case "node.add": {
      if (document.nodes.some((node) => node.id === command.node.id))
        throw new Error("节点 ID 已存在");
      next = { ...document, nodes: [...document.nodes, command.node] };
      break;
    }
    case "node.move": {
      const changes = new Map<string, Point>();
      for (const { id, ...point } of command.positions) {
        assertPoint(point);
        if (changes.has(id)) throw new Error("移动指令包含重复节点");
        changes.set(id, point);
      }
      if (
        [...changes.keys()].some(
          (id) => !document.nodes.some((node) => node.id === id),
        )
      )
        throw new Error("要移动的节点不存在");
      next = {
        ...document,
        nodes: document.nodes.map((node) => {
          const position = changes.get(node.id);
          return position
            ? { ...node, frame: { ...node.frame, ...position } }
            : node;
        }),
      };
      break;
    }
    case "node.resize": {
      if (!document.nodes.some((node) => node.id === command.id))
        throw new Error("要调整尺寸的节点不存在");
      if (
        ![command.width, command.height].every(finite) ||
        command.width < MIN_DIMENSION ||
        command.height < MIN_DIMENSION ||
        command.width > MAX_DIMENSION ||
        command.height > MAX_DIMENSION
      )
        throw new Error("节点尺寸超出允许范围");
      next = {
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === command.id
            ? {
                ...node,
                frame: {
                  ...node.frame,
                  width: command.width,
                  height: command.height,
                },
              }
            : node,
        ),
      };
      break;
    }
    case "node.remove": {
      const removed = new Set(command.ids);
      next = {
        ...document,
        nodes: document.nodes.filter((node) => !removed.has(node.id)),
        edges: document.edges.filter(
          (edge) => !removed.has(edge.from) && !removed.has(edge.to),
        ),
      };
      break;
    }
    case "edge.connect":
      next = { ...document, edges: [...document.edges, command.edge] };
      break;
    case "edge.remove":
      next = {
        ...document,
        edges: document.edges.filter((edge) => edge.id !== command.id),
      };
      break;
    case "viewport.set":
      next = { ...document, viewport: command.viewport };
      break;
  }
  assertProductDocument(next);
  return next;
}
