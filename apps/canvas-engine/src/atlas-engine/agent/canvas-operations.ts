import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { getNodeSpec } from "@/constant/canvas";
import {
  isAtlasBuiltinNodeType,
  isAtlasNodeTypeRegistered,
} from "@/atlas-engine/model/node-registry";
import { clampCanvasZoom } from "@/atlas-engine/surface/viewport";
import type {
  CanvasConnection,
  CanvasNodeData,
  CanvasNodeMetadata,
  CanvasNodeTypeId,
  ViewportTransform,
} from "@/types/canvas";

export type CanvasAgentOp =
  | {
      type: "add_node";
      id?: string;
      nodeType?: CanvasNodeTypeId;
      title?: string;
      position?: { x: number; y: number };
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      metadata?: CanvasNodeMetadata;
    }
  | {
      type: "update_node";
      id: string;
      patch?: Partial<CanvasNodeData>;
      metadata?: CanvasNodeMetadata;
    }
  | {
      type: "delete_node";
      id?: string;
      ids?: string[];
      nodeType?: CanvasNodeTypeId;
    }
  | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
  | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
  | { type: "set_viewport"; viewport: ViewportTransform }
  | { type: "select_nodes"; ids: string[] }
  | {
      type: "run_generation";
      nodeId: string;
      mode?: "text" | "image" | "video" | "audio";
      prompt?: string;
    };

export type CanvasAgentSnapshot = {
  projectId: string;
  title: string;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  selectedNodeIds: string[];
  viewport: ViewportTransform;
};

type Transaction = {
  source: CanvasAgentSnapshot;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  selection: string[];
  viewport: ViewportTransform;
  nodesChanged: boolean;
  connectionsChanged: boolean;
  selectionChanged: boolean;
  viewportChanged: boolean;
  nodeIds: Set<string>;
  connectionIds: Set<string>;
  endpointPairs: Set<string>;
};

const pairKey = (from: string, to: string) => `${from}\u0000${to}`;
const finiteOr = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const positiveOr = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;

function beginTransaction(snapshot: CanvasAgentSnapshot): Transaction {
  return {
    source: snapshot,
    nodes: snapshot.nodes,
    connections: snapshot.connections,
    selection: snapshot.selectedNodeIds,
    viewport: snapshot.viewport,
    nodesChanged: false,
    connectionsChanged: false,
    selectionChanged: false,
    viewportChanged: false,
    nodeIds: new Set(snapshot.nodes.map(({ id }) => id)),
    connectionIds: new Set(snapshot.connections.map(({ id }) => id)),
    endpointPairs: new Set(
      snapshot.connections.map(({ fromNodeId, toNodeId }) =>
        pairKey(fromNodeId, toNodeId),
      ),
    ),
  };
}

function editNodes(tx: Transaction) {
  if (!tx.nodesChanged) {
    tx.nodes = [...tx.nodes];
    tx.nodesChanged = true;
  }
  return tx.nodes;
}

function editConnections(tx: Transaction) {
  if (!tx.connectionsChanged) {
    tx.connections = [...tx.connections];
    tx.connectionsChanged = true;
  }
  return tx.connections;
}

function makeUniqueId(preferred: string | undefined, occupied: Set<string>) {
  if (preferred && !occupied.has(preferred)) return preferred;
  let id = nanoid();
  while (occupied.has(id)) id = nanoid();
  return id;
}

function resolveNodeType(type: CanvasNodeTypeId | undefined): CanvasNodeTypeId {
  if (type && (isAtlasBuiltinNodeType(type) || isAtlasNodeTypeRegistered(type)))
    return type;
  return "text";
}

function addNode(
  tx: Transaction,
  operation: Extract<CanvasAgentOp, { type: "add_node" }>,
  ordinal: number,
) {
  const type = resolveNodeType(operation.nodeType);
  const spec = getNodeSpec(type);
  const id = makeUniqueId(operation.id, tx.nodeIds);
  const fallback = ordinal * 36;
  const position = operation.position ?? {
    x: operation.x ?? fallback,
    y: operation.y ?? fallback,
  };
  const node: CanvasNodeData = {
    id,
    type,
    title: operation.title?.trim() || spec.title,
    position: {
      x: finiteOr(position.x, fallback),
      y: finiteOr(position.y, fallback),
    },
    width: positiveOr(operation.width, spec.width),
    height: positiveOr(operation.height, spec.height),
    metadata: { ...spec.metadata, ...operation.metadata },
  };

  tx.nodeIds.add(id);
  editNodes(tx).push(node);
  tx.selection = [id];
  tx.selectionChanged = true;
}

function updateNode(
  tx: Transaction,
  operation: Extract<CanvasAgentOp, { type: "update_node" }>,
) {
  const index = tx.nodes.findIndex(({ id }) => id === operation.id);
  if (index < 0) return;

  const previous = tx.nodes[index];
  const patch = operation.patch ?? {};
  const candidateType = patch.type;
  const type =
    candidateType &&
    (isAtlasBuiltinNodeType(candidateType) ||
      isAtlasNodeTypeRegistered(candidateType))
      ? candidateType
      : previous.type;
  const position = patch.position ?? previous.position;
  const next: CanvasNodeData = {
    ...previous,
    ...patch,
    id: previous.id,
    type,
    position: {
      x: finiteOr(position.x, previous.position.x),
      y: finiteOr(position.y, previous.position.y),
    },
    width: positiveOr(patch.width, previous.width),
    height: positiveOr(patch.height, previous.height),
    metadata: {
      ...previous.metadata,
      ...patch.metadata,
      ...operation.metadata,
    },
  };
  editNodes(tx)[index] = next;
}

function deleteNodes(
  tx: Transaction,
  operation: Extract<CanvasAgentOp, { type: "delete_node" }>,
) {
  const ids =
    operation.ids ??
    (operation.id
      ? [operation.id]
      : operation.nodeType
        ? tx.nodes
            .filter((node) => node.type === operation.nodeType)
            .map(({ id }) => id)
        : []);
  const removed = new Set(ids.filter((id) => tx.nodeIds.has(id)));
  if (!removed.size) return;

  tx.nodes = tx.nodes.filter(({ id }) => !removed.has(id));
  tx.nodesChanged = true;
  for (const id of removed) tx.nodeIds.delete(id);

  const keptConnections = tx.connections.filter(
    ({ fromNodeId, toNodeId }) =>
      !removed.has(fromNodeId) && !removed.has(toNodeId),
  );
  if (keptConnections.length !== tx.connections.length) {
    tx.connections = keptConnections;
    tx.connectionsChanged = true;
    tx.connectionIds = new Set(keptConnections.map(({ id }) => id));
    tx.endpointPairs = new Set(
      keptConnections.map(({ fromNodeId, toNodeId }) =>
        pairKey(fromNodeId, toNodeId),
      ),
    );
  }

  const nextSelection = tx.selection.filter((id) => tx.nodeIds.has(id));
  if (nextSelection.length !== tx.selection.length) {
    tx.selection = nextSelection;
    tx.selectionChanged = true;
  }
}

function deleteConnections(
  tx: Transaction,
  operation: Extract<CanvasAgentOp, { type: "delete_connections" }>,
) {
  if (!tx.connections.length) return;
  const requested = operation.all
    ? undefined
    : new Set(operation.ids ?? (operation.id ? [operation.id] : []));
  if (requested && requested.size === 0) return;
  const remaining = requested
    ? tx.connections.filter(({ id }) => !requested.has(id))
    : [];
  if (remaining.length === tx.connections.length) return;

  tx.connections = remaining;
  tx.connectionsChanged = true;
  tx.connectionIds = new Set(remaining.map(({ id }) => id));
  tx.endpointPairs = new Set(
    remaining.map(({ fromNodeId, toNodeId }) => pairKey(fromNodeId, toNodeId)),
  );
}

function connectNodes(
  tx: Transaction,
  operation: Extract<CanvasAgentOp, { type: "connect_nodes" }>,
) {
  const { fromNodeId, toNodeId } = operation;
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
  if (!tx.nodeIds.has(fromNodeId) || !tx.nodeIds.has(toNodeId)) return;
  const pair = pairKey(fromNodeId, toNodeId);
  if (tx.endpointPairs.has(pair)) return;

  const id = makeUniqueId(operation.id, tx.connectionIds);
  editConnections(tx).push({ id, fromNodeId, toNodeId });
  tx.connectionIds.add(id);
  tx.endpointPairs.add(pair);
}

function setViewport(tx: Transaction, value: ViewportTransform) {
  tx.viewport = {
    x: finiteOr(value.x, 0),
    y: finiteOr(value.y, 0),
    k: clampCanvasZoom(finiteOr(value.k, 1)),
  };
  tx.viewportChanged = true;
}

function selectNodes(tx: Transaction, ids: string[]) {
  const next = [...new Set(ids)].filter((id) => tx.nodeIds.has(id));
  const same =
    next.length === tx.selection.length &&
    next.every((id, index) => id === tx.selection[index]);
  if (same) return;
  tx.selection = next;
  tx.selectionChanged = true;
}

function applyOperation(
  tx: Transaction,
  operation: CanvasAgentOp,
  ordinal: number,
) {
  switch (operation.type) {
    case "add_node":
      addNode(tx, operation, ordinal);
      break;
    case "update_node":
      updateNode(tx, operation);
      break;
    case "delete_node":
      deleteNodes(tx, operation);
      break;
    case "delete_connections":
      deleteConnections(tx, operation);
      break;
    case "connect_nodes":
      connectNodes(tx, operation);
      break;
    case "set_viewport":
      setViewport(tx, operation.viewport);
      break;
    case "select_nodes":
      selectNodes(tx, operation.ids);
      break;
    case "run_generation":
      break;
  }
}

export function applyCanvasAgentOps(
  snapshot: CanvasAgentSnapshot,
  operations?: CanvasAgentOp[],
) {
  const tx = beginTransaction(snapshot);
  for (const [ordinal, operation] of (operations ?? []).entries()) {
    if (operation && typeof operation.type === "string")
      applyOperation(tx, operation, ordinal);
  }
  return {
    ...snapshot,
    nodes: tx.nodesChanged ? tx.nodes : snapshot.nodes,
    connections: tx.connectionsChanged ? tx.connections : snapshot.connections,
    selectedNodeIds: tx.selectionChanged
      ? tx.selection
      : snapshot.selectedNodeIds,
    viewport: tx.viewportChanged ? tx.viewport : snapshot.viewport,
  };
}

export function summarizeCanvasAgentOps(operations?: CanvasAgentOp[]) {
  const frequencies = new Map<string, number>();
  for (const operation of operations ?? []) {
    if (!operation || typeof operation.type !== "string") continue;
    frequencies.set(operation.type, (frequencies.get(operation.type) ?? 0) + 1);
  }
  return Array.from(
    frequencies,
    ([type, count]) =>
      `${i18n.t(`canvas.agentOps.${type}`, { defaultValue: type })} ${count}`,
  ).join("，");
}
