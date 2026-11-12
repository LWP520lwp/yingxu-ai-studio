import type { CanvasConnection, CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";

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

const DEFAULT_TITLE = "未命名创作";
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clone<T>(value: T): T {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
}

function finishCommand(document: WorkbenchDocument, next: WorkbenchDocument): WorkbenchDocument {
    const issues = validateWorkbenchDocument(next);
    if (issues.length) throw new Error(`画布文档校验失败：${issues[0].message}`);
    return { ...next, revision: document.revision + 1 };
}

export function createWorkbenchDocument(input: Partial<WorkbenchDocument> & Pick<WorkbenchDocument, "id">): WorkbenchDocument {
    const document: WorkbenchDocument = {
        id: input.id,
        title: typeof input.title === "string" ? input.title.trim() || DEFAULT_TITLE : DEFAULT_TITLE,
        revision: Math.max(0, Math.floor(finiteNumber(input.revision, 0))),
        viewport: normalizeViewport(input.viewport),
        nodes: clone(input.nodes || []),
        connections: clone(input.connections || []),
    };
    const issues = validateWorkbenchDocument(document);
    if (issues.length) throw new Error(`画布文档校验失败：${issues[0].message}`);
    return document;
}

export function normalizeViewport(value?: Partial<ViewportTransform>): ViewportTransform {
    return {
        x: finiteNumber(value?.x, 0),
        y: finiteNumber(value?.y, 0),
        k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, finiteNumber(value?.k, 1))),
    };
}

export function validateWorkbenchDocument(document: WorkbenchDocument): DocumentIssue[] {
    const issues: DocumentIssue[] = [];
    if (!isRecord(document)) return [{ path: "", message: "画布文档格式无效" }];
    if (typeof document.id !== "string" || !document.id.trim()) issues.push({ path: "id", message: "文档标识不能为空" });
    if (!Array.isArray(document.nodes)) issues.push({ path: "nodes", message: "节点列表格式无效" });
    if (!Array.isArray(document.connections)) issues.push({ path: "connections", message: "连接列表格式无效" });
    if (!Array.isArray(document.nodes) || !Array.isArray(document.connections)) return issues;

    const nodeIds = new Set<string>();
    document.nodes.forEach((value, index) => {
        const path = `nodes.${index}`;
        if (!isRecord(value)) {
            issues.push({ path, message: "节点格式无效" });
            return;
        }
        const nodeId = value.id;
        if (typeof nodeId !== "string" || !nodeId.trim()) {
            issues.push({ path: `${path}.id`, message: "节点标识不能为空" });
        } else if (nodeIds.has(nodeId)) {
            issues.push({ path: `${path}.id`, message: "节点标识重复" });
        } else {
            nodeIds.add(nodeId);
        }
        if (!isRecord(value.position) || !Number.isFinite(value.position.x) || !Number.isFinite(value.position.y)) {
            issues.push({ path: `${path}.position`, message: "节点位置必须是有限数字" });
        }
        if (!Number.isFinite(value.width) || Number(value.width) <= 0 || !Number.isFinite(value.height) || Number(value.height) <= 0) {
            issues.push({ path, message: "节点尺寸必须是正数" });
        }
    });

    const connectionIds = new Set<string>();
    const directedPairs = new Set<string>();
    document.connections.forEach((value, index) => {
        const path = `connections.${index}`;
        if (!isRecord(value)) {
            issues.push({ path, message: "连接格式无效" });
            return;
        }
        const connectionId = value.id;
        if (typeof connectionId !== "string" || !connectionId.trim() || connectionIds.has(connectionId)) {
            issues.push({ path: `${path}.id`, message: "连接标识为空或重复" });
        } else {
            connectionIds.add(connectionId);
        }
        const from = value.fromNodeId;
        const to = value.toNodeId;
        if (typeof from !== "string" || typeof to !== "string" || !nodeIds.has(from) || !nodeIds.has(to)) {
            issues.push({ path, message: "连接引用了不存在的节点" });
        }
        if (typeof from === "string" && from === to) issues.push({ path, message: "节点不能连接到自身" });
        if (typeof from === "string" && typeof to === "string") {
            const pair = `${from}\u0000${to}`;
            if (directedPairs.has(pair)) issues.push({ path, message: "相同方向的连接只能保留一条" });
            directedPairs.add(pair);
        }
    });
    return issues;
}

export function reduceWorkbenchDocument(document: WorkbenchDocument, command: WorkbenchDocumentCommand): WorkbenchDocument {
    let next: WorkbenchDocument;
    switch (command.type) {
        case "rename":
            next = { ...document, title: command.title.trim() || document.title };
            break;
        case "viewport":
            next = { ...document, viewport: normalizeViewport({ ...document.viewport, ...command.viewport }) };
            break;
        case "add-node":
            if (document.nodes.some(({ id }) => id === command.node.id)) throw new Error("节点标识已存在");
            next = { ...document, nodes: [...document.nodes, clone(command.node)] };
            break;
        case "patch-node": {
            const index = document.nodes.findIndex(({ id }) => id === command.nodeId);
            if (index < 0) throw new Error("节点不存在");
            const nodes = document.nodes.slice();
            nodes[index] = { ...nodes[index], ...clone(command.patch), id: command.nodeId };
            next = { ...document, nodes };
            break;
        }
        case "remove-nodes": {
            const removedIds = new Set(command.nodeIds);
            next = {
                ...document,
                nodes: document.nodes.filter(({ id }) => !removedIds.has(id)),
                connections: document.connections.filter((edge) => !removedIds.has(edge.fromNodeId) && !removedIds.has(edge.toNodeId)),
            };
            break;
        }
        case "connect": {
            const { fromNodeId, toNodeId } = command.connection;
            const existingIds = new Set(document.nodes.map(({ id }) => id));
            if (!existingIds.has(fromNodeId) || !existingIds.has(toNodeId)) throw new Error("连接引用了不存在的节点");
            if (fromNodeId === toNodeId) throw new Error("节点不能连接到自身");
            if (document.connections.some((edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId)) return document;
            next = { ...document, connections: [...document.connections, clone(command.connection)] };
            break;
        }
        case "remove-connections": {
            const removedIds = new Set(command.connectionIds);
            next = { ...document, connections: document.connections.filter(({ id }) => !removedIds.has(id)) };
            break;
        }
    }
    return finishCommand(document, next);
}

export function nodeCenter(node: Pick<CanvasNodeData, "position" | "width" | "height">): Position {
    return {
        x: node.position.x + node.width / 2,
        y: node.position.y + node.height / 2,
    };
}
