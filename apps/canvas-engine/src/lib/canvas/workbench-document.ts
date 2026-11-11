import type { CanvasConnection, CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";

/**
 * Domain model for an editable workbench document.
 *
 * The canvas UI should deal in these commands instead of mutating a store or
 * serialising React state directly. Keeping this boundary small makes the
 * document format portable between the embedded canvas, the web shell and a
 * future native editor.
 */
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

const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const copy = <T,>(value: T): T => structuredClone(value);

export function createWorkbenchDocument(input: Partial<WorkbenchDocument> & Pick<WorkbenchDocument, "id">): WorkbenchDocument {
    const nodes = copy(input.nodes || []);
    const connections = copy(input.connections || []);
    const document: WorkbenchDocument = {
        id: input.id,
        title: input.title?.trim() || "未命名创作",
        revision: Math.max(0, Math.floor(finite(input.revision, 0))),
        viewport: normalizeViewport(input.viewport),
        nodes,
        connections,
    };
    const issues = validateWorkbenchDocument(document);
    if (issues.length) throw new Error(`画布文档校验失败：${issues[0].message}`);
    return document;
}

export function normalizeViewport(value?: Partial<ViewportTransform>): ViewportTransform {
    return {
        x: finite(value?.x, 0),
        y: finite(value?.y, 0),
        k: Math.min(4, Math.max(0.05, finite(value?.k, 1))),
    };
}

export function validateWorkbenchDocument(document: WorkbenchDocument): DocumentIssue[] {
    const issues: DocumentIssue[] = [];
    if (!document.id.trim()) issues.push({ path: "id", message: "文档标识不能为空" });
    const nodeIds = new Set<string>();
    document.nodes.forEach((node, index) => {
        if (!node.id.trim()) issues.push({ path: `nodes.${index}.id`, message: "节点标识不能为空" });
        if (nodeIds.has(node.id)) issues.push({ path: `nodes.${index}.id`, message: "节点标识重复" });
        nodeIds.add(node.id);
        if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) issues.push({ path: `nodes.${index}.position`, message: "节点位置必须是有限数字" });
        if (!Number.isFinite(node.width) || node.width <= 0 || !Number.isFinite(node.height) || node.height <= 0) issues.push({ path: `nodes.${index}`, message: "节点尺寸必须是正数" });
    });
    const connectionIds = new Set<string>();
    const pairs = new Set<string>();
    document.connections.forEach((connection, index) => {
        if (!connection.id.trim() || connectionIds.has(connection.id)) issues.push({ path: `connections.${index}.id`, message: "连接标识为空或重复" });
        connectionIds.add(connection.id);
        if (!nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId)) issues.push({ path: `connections.${index}`, message: "连接引用了不存在的节点" });
        if (connection.fromNodeId === connection.toNodeId) issues.push({ path: `connections.${index}`, message: "节点不能连接到自身" });
        const pair = `${connection.fromNodeId}\u0000${connection.toNodeId}`;
        if (pairs.has(pair)) issues.push({ path: `connections.${index}`, message: "相同方向的连接只能保留一条" });
        pairs.add(pair);
    });
    return issues;
}

export function reduceWorkbenchDocument(document: WorkbenchDocument, command: WorkbenchDocumentCommand): WorkbenchDocument {
    const next = copy(document);
    switch (command.type) {
        case "rename":
            next.title = command.title.trim() || next.title;
            break;
        case "viewport":
            next.viewport = normalizeViewport({ ...next.viewport, ...command.viewport });
            break;
        case "add-node":
            if (next.nodes.some((node) => node.id === command.node.id)) throw new Error("节点标识已存在");
            next.nodes.push(copy(command.node));
            break;
        case "patch-node": {
            const index = next.nodes.findIndex((node) => node.id === command.nodeId);
            if (index < 0) throw new Error("节点不存在");
            next.nodes[index] = { ...next.nodes[index], ...copy(command.patch), id: command.nodeId };
            break;
        }
        case "remove-nodes": {
            const removed = new Set(command.nodeIds);
            next.nodes = next.nodes.filter((node) => !removed.has(node.id));
            next.connections = next.connections.filter((edge) => !removed.has(edge.fromNodeId) && !removed.has(edge.toNodeId));
            break;
        }
        case "connect":
            if (!next.nodes.some((node) => node.id === command.connection.fromNodeId) || !next.nodes.some((node) => node.id === command.connection.toNodeId)) throw new Error("连接引用了不存在的节点");
            if (command.connection.fromNodeId === command.connection.toNodeId) throw new Error("节点不能连接到自身");
            if (next.connections.some((edge) => edge.fromNodeId === command.connection.fromNodeId && edge.toNodeId === command.connection.toNodeId)) return document;
            next.connections.push(copy(command.connection));
            break;
        case "remove-connections": {
            const removed = new Set(command.connectionIds);
            next.connections = next.connections.filter((edge) => !removed.has(edge.id));
            break;
        }
    }
    const issues = validateWorkbenchDocument(next);
    if (issues.length) throw new Error(`画布文档校验失败：${issues[0].message}`);
    return { ...next, revision: document.revision + 1 };
}

export function nodeCenter(node: Pick<CanvasNodeData, "position" | "width" | "height">): Position {
    return { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
}
