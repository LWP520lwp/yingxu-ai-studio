import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { getNodeSpec, isRegisteredNodeType } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type ViewportTransform } from "@/types/canvas";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

type CanvasState = Pick<CanvasAgentSnapshot, "nodes" | "connections" | "selectedNodeIds" | "viewport">;

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = new Map<string, number>();
    for (const op of Array.isArray(ops) ? ops : []) {
        if (!op || typeof op.type !== "string") continue;
        counts.set(op.type, (counts.get(op.type) || 0) + 1);
    }
    return [...counts].map(([type, count]) => `${opLabel(type)} ${count}`).join("，");
}

function finite(value: number, fallback: number) {
    return Number.isFinite(value) ? value : fallback;
}

function positive(value: number, fallback: number) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function uniqueId(preferred: string | undefined, exists: (id: string) => boolean) {
    if (preferred && !exists(preferred)) return preferred;
    let id = nanoid();
    while (exists(id)) id = nanoid();
    return id;
}

function createNode(state: CanvasState, op: Extract<CanvasAgentOp, { type: "add_node" }>, index: number): CanvasState {
    const nodeType = op.nodeType && isRegisteredNodeType(op.nodeType) ? op.nodeType : CanvasNodeType.Text;
    const spec = getNodeSpec(nodeType);
    const id = uniqueId(op.id, (candidate) => state.nodes.some((node) => node.id === candidate));
    const fallbackPosition = { x: index * 36, y: index * 36 };
    const requestedPosition = op.position || { x: op.x ?? fallbackPosition.x, y: op.y ?? fallbackPosition.y };
    const node: CanvasNodeData = {
        id,
        type: nodeType,
        title: op.title?.trim() || spec.title,
        position: { x: finite(requestedPosition.x, fallbackPosition.x), y: finite(requestedPosition.y, fallbackPosition.y) },
        width: positive(op.width ?? spec.width, spec.width),
        height: positive(op.height ?? spec.height, spec.height),
        metadata: { ...spec.metadata, ...op.metadata },
    };
    return { ...state, nodes: [...state.nodes, node], selectedNodeIds: [node.id] };
}

function updateNode(state: CanvasState, op: Extract<CanvasAgentOp, { type: "update_node" }>): CanvasState {
    if (!op.id) return state;
    const target = state.nodes.find((node) => node.id === op.id);
    if (!target) return state;
    const patch = op.patch || {};
    const nextType = patch.type && isRegisteredNodeType(patch.type) ? patch.type : target.type;
    const position = patch.position || target.position;
    const updated: CanvasNodeData = {
        ...target,
        ...patch,
        id: target.id,
        type: nextType,
        position: { x: finite(position.x, target.position.x), y: finite(position.y, target.position.y) },
        width: positive(patch.width ?? target.width, target.width),
        height: positive(patch.height ?? target.height, target.height),
        metadata: { ...target.metadata, ...patch.metadata, ...op.metadata },
    };
    return { ...state, nodes: state.nodes.map((node) => node.id === op.id ? updated : node) };
}

function deleteNodes(state: CanvasState, op: Extract<CanvasAgentOp, { type: "delete_node" }>): CanvasState {
    const requestedIds = op.ids ?? (op.id ? [op.id] : op.nodeType ? state.nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []);
    const removed = new Set(requestedIds);
    if (!removed.size) return state;
    const nodes = state.nodes.filter((node) => !removed.has(node.id));
    const remainingIds = new Set(nodes.map((node) => node.id));
    return {
        ...state,
        nodes,
        connections: state.connections.filter((connection) => !removed.has(connection.fromNodeId) && !removed.has(connection.toNodeId)),
        selectedNodeIds: state.selectedNodeIds.filter((id) => remainingIds.has(id)),
    };
}

function connectNodes(state: CanvasState, op: Extract<CanvasAgentOp, { type: "connect_nodes" }>): CanvasState {
    if (!op.fromNodeId || !op.toNodeId || op.fromNodeId === op.toNodeId) return state;
    const hasSource = state.nodes.some((node) => node.id === op.fromNodeId);
    const hasTarget = state.nodes.some((node) => node.id === op.toNodeId);
    const exists = state.connections.some((connection) => connection.fromNodeId === op.fromNodeId && connection.toNodeId === op.toNodeId);
    if (!hasSource || !hasTarget || exists) return state;
    const id = uniqueId(op.id, (candidate) => state.connections.some((connection) => connection.id === candidate));
    return { ...state, connections: [...state.connections, { id, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }] };
}

function updateViewport(state: CanvasState, viewport: ViewportTransform): CanvasState {
    return {
        ...state,
        viewport: {
            x: finite(viewport.x, 0),
            y: finite(viewport.y, 0),
            k: Math.min(5, Math.max(0.05, finite(viewport.k, 1))),
        },
    };
}

function applyOperation(state: CanvasState, op: CanvasAgentOp, index: number): CanvasState {
    switch (op.type) {
        case "add_node":
            return createNode(state, op, index);
        case "update_node":
            return updateNode(state, op);
        case "delete_node":
            return deleteNodes(state, op);
        case "delete_connections": {
            if (op.all) return state.connections.length ? { ...state, connections: [] } : state;
            const ids = new Set(op.ids ?? (op.id ? [op.id] : []));
            if (!ids.size) return state;
            const connections = state.connections.filter((connection) => !ids.has(connection.id));
            return connections.length === state.connections.length ? state : { ...state, connections };
        }
        case "connect_nodes":
            return connectNodes(state, op);
        case "set_viewport":
            return updateViewport(state, op.viewport);
        case "select_nodes": {
            const known = new Set(state.nodes.map((node) => node.id));
            const ids = [...new Set(op.ids)].filter((id) => known.has(id));
            return { ...state, selectedNodeIds: ids };
        }
        case "run_generation":
            return state;
    }
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let state: CanvasState = {
        nodes: snapshot.nodes,
        connections: snapshot.connections,
        selectedNodeIds: snapshot.selectedNodeIds,
        viewport: snapshot.viewport,
    };
    for (const [index, op] of (Array.isArray(ops) ? ops : []).entries()) {
        if (op && typeof op.type === "string") state = applyOperation(state, op, index);
    }
    return { ...snapshot, ...state };
}

function opLabel(type: string) {
    return i18n.t(`canvas.agentOps.${type}`, { defaultValue: type });
}
