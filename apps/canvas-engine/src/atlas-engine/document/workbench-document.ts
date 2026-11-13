import type {
  CanvasConnection,
  CanvasNodeData,
  Position,
  ViewportTransform,
} from "@/types/canvas";

export type WorkbenchDocument = {
  id: string;
  title: string;
  revision: number;
  viewport: ViewportTransform;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
};

export type WorkbenchDocumentCommand =
  | { type: "rename"; title: string }
  | { type: "viewport"; viewport: Partial<ViewportTransform> }
  | { type: "add-node"; node: CanvasNodeData }
  | { type: "patch-node"; nodeId: string; patch: Partial<CanvasNodeData> }
  | { type: "remove-nodes"; nodeIds: string[] }
  | { type: "connect"; connection: CanvasConnection }
  | { type: "remove-connections"; connectionIds: string[] };

export type DocumentIssue = { path: string; message: string };

const EMPTY_TITLE = "未命名创作";
const ZOOM_RANGE = { min: 0.05, max: 4 } as const;
type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function duplicateSafeCopy<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertValid(document: WorkbenchDocument): WorkbenchDocument {
  const [issue] = validateWorkbenchDocument(document);
  if (issue) throw new Error(`画布文档校验失败：${issue.message}`);
  return document;
}

function advance(document: WorkbenchDocument, candidate: WorkbenchDocument) {
  return { ...assertValid(candidate), revision: document.revision + 1 };
}

export function normalizeViewport(
  value?: Partial<ViewportTransform>,
): ViewportTransform {
  const zoom = numberOr(value?.k, 1);
  return {
    x: numberOr(value?.x, 0),
    y: numberOr(value?.y, 0),
    k: Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, zoom)),
  };
}

export function createWorkbenchDocument(
  input: Partial<WorkbenchDocument> & Pick<WorkbenchDocument, "id">,
): WorkbenchDocument {
  const document: WorkbenchDocument = {
    id: input.id,
    title:
      typeof input.title === "string"
        ? input.title.trim() || EMPTY_TITLE
        : EMPTY_TITLE,
    revision: Math.max(0, Math.floor(numberOr(input.revision, 0))),
    viewport: normalizeViewport(input.viewport),
    nodes: duplicateSafeCopy(input.nodes ?? []),
    connections: duplicateSafeCopy(input.connections ?? []),
  };
  return assertValid(document);
}

function validateNode(
  value: unknown,
  index: number,
  ids: Set<string>,
  issues: DocumentIssue[],
) {
  const path = `nodes.${index}`;
  if (!isRecord(value)) {
    issues.push({ path, message: "节点格式无效" });
    return;
  }

  if (typeof value.id !== "string" || !value.id.trim()) {
    issues.push({ path: `${path}.id`, message: "节点标识不能为空" });
  } else if (ids.has(value.id)) {
    issues.push({ path: `${path}.id`, message: "节点标识重复" });
  } else {
    ids.add(value.id);
  }

  const position = value.position;
  if (
    !isRecord(position) ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    issues.push({
      path: `${path}.position`,
      message: "节点位置必须是有限数字",
    });
  }
  if (
    !Number.isFinite(value.width) ||
    Number(value.width) <= 0 ||
    !Number.isFinite(value.height) ||
    Number(value.height) <= 0
  ) {
    issues.push({ path, message: "节点尺寸必须是正数" });
  }
}

function validateConnection(
  value: unknown,
  index: number,
  nodeIds: Set<string>,
  connectionIds: Set<string>,
  directedPairs: Set<string>,
  issues: DocumentIssue[],
) {
  const path = `connections.${index}`;
  if (!isRecord(value)) {
    issues.push({ path, message: "连接格式无效" });
    return;
  }

  if (
    typeof value.id !== "string" ||
    !value.id.trim() ||
    connectionIds.has(value.id)
  ) {
    issues.push({ path: `${path}.id`, message: "连接标识为空或重复" });
  } else {
    connectionIds.add(value.id);
  }

  const source = value.fromNodeId;
  const target = value.toNodeId;
  if (
    typeof source !== "string" ||
    typeof target !== "string" ||
    !nodeIds.has(source) ||
    !nodeIds.has(target)
  ) {
    issues.push({ path, message: "连接引用了不存在的节点" });
  }
  if (typeof source === "string" && source === target)
    issues.push({ path, message: "节点不能连接到自身" });
  if (typeof source === "string" && typeof target === "string") {
    const pair = JSON.stringify([source, target]);
    if (directedPairs.has(pair))
      issues.push({ path, message: "相同方向的连接只能保留一条" });
    directedPairs.add(pair);
  }
}

export function validateWorkbenchDocument(
  document: WorkbenchDocument,
): DocumentIssue[] {
  if (!isRecord(document)) return [{ path: "", message: "画布文档格式无效" }];
  const issues: DocumentIssue[] = [];
  if (typeof document.id !== "string" || !document.id.trim())
    issues.push({ path: "id", message: "文档标识不能为空" });
  if (!Array.isArray(document.nodes))
    issues.push({ path: "nodes", message: "节点列表格式无效" });
  if (!Array.isArray(document.connections))
    issues.push({ path: "connections", message: "连接列表格式无效" });
  if (!Array.isArray(document.nodes) || !Array.isArray(document.connections))
    return issues;

  const nodeIds = new Set<string>();
  document.nodes.forEach((node, index) =>
    validateNode(node, index, nodeIds, issues),
  );
  const connectionIds = new Set<string>();
  const directedPairs = new Set<string>();
  document.connections.forEach((connection, index) =>
    validateConnection(
      connection,
      index,
      nodeIds,
      connectionIds,
      directedPairs,
      issues,
    ),
  );
  return issues;
}

export function reduceWorkbenchDocument(
  document: WorkbenchDocument,
  command: WorkbenchDocumentCommand,
): WorkbenchDocument {
  switch (command.type) {
    case "rename":
      return advance(document, {
        ...document,
        title: command.title.trim() || document.title,
      });
    case "viewport":
      return advance(document, {
        ...document,
        viewport: normalizeViewport({
          ...document.viewport,
          ...command.viewport,
        }),
      });
    case "add-node": {
      if (document.nodes.some((node) => node.id === command.node.id))
        throw new Error("节点标识已存在");
      return advance(document, {
        ...document,
        nodes: [...document.nodes, duplicateSafeCopy(command.node)],
      });
    }
    case "patch-node": {
      const index = document.nodes.findIndex(
        (node) => node.id === command.nodeId,
      );
      if (index < 0) throw new Error("节点不存在");
      const nodes = document.nodes.slice();
      nodes[index] = {
        ...nodes[index],
        ...duplicateSafeCopy(command.patch),
        id: command.nodeId,
      };
      return advance(document, { ...document, nodes });
    }
    case "remove-nodes": {
      const removed = new Set(command.nodeIds);
      return advance(document, {
        ...document,
        nodes: document.nodes.filter((node) => !removed.has(node.id)),
        connections: document.connections.filter(
          (edge) =>
            !removed.has(edge.fromNodeId) && !removed.has(edge.toNodeId),
        ),
      });
    }
    case "connect": {
      const nodeIds = new Set(document.nodes.map((node) => node.id));
      const { fromNodeId, toNodeId } = command.connection;
      if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId))
        throw new Error("连接引用了不存在的节点");
      if (fromNodeId === toNodeId) throw new Error("节点不能连接到自身");
      if (
        document.connections.some(
          (edge) =>
            edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId,
        )
      )
        return document;
      return advance(document, {
        ...document,
        connections: [
          ...document.connections,
          duplicateSafeCopy(command.connection),
        ],
      });
    }
    case "remove-connections": {
      const removed = new Set(command.connectionIds);
      return advance(document, {
        ...document,
        connections: document.connections.filter(
          (edge) => !removed.has(edge.id),
        ),
      });
    }
  }
}

export function nodeCenter(
  node: Pick<CanvasNodeData, "position" | "width" | "height">,
): Position {
  return {
    x: node.position.x + node.width / 2,
    y: node.position.y + node.height / 2,
  };
}
