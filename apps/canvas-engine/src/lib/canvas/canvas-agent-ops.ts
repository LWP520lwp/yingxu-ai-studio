import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { getNodeSpec, isRegisteredNodeType } from "@/lib/canvas/node-registry";
import type { CanvasProject } from "./canvas-project-catalog";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type CanvasNodeMetadata,
  type CanvasNodeTypeId,
  type ViewportTransform,
} from "@/types/canvas";

export type CanvasAgentOp =
  | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
  | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
  | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
  | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
  | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
  | { type: "set_viewport"; viewport: ViewportTransform }
  | { type: "select_nodes"; ids: string[] }
  | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = Pick<CanvasProject, "title" | "nodes" | "connections" | "viewport"> & {
  projectId: string;
  selectedNodeIds: string[];
};

type WorkingGraph = {
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  selected: string[];
  viewport: ViewportTransform;
  nodeIndex: Map<string, number>;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  edges: Set<string>;
  dirtyNodes: boolean;
  dirtyConnections: boolean;
  dirtySelection: boolean;
  dirtyViewport: boolean;
};

const VIEWPORT_MIN = 0.05;
const VIEWPORT_MAX = 5;

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
  const totals = new Map<string, number>();
  for (const operation of ops ?? []) {
    if (!operation || typeof operation.type !== "string") continue;
    totals.set(operation.type, (totals.get(operation.type) ?? 0) + 1);
  }
  return [...totals].map(([type, count]) => `${operationLabel(type)} ${count}`).join("，");
}

function operationLabel(type: string) {
  return i18n.t(`canvas.agentOps.${type}`, { defaultValue: type });
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function uniqueId(preferred: string | undefined, used: Set<string>) {
  if (preferred && !used.has(preferred)) return preferred;
  let generated = nanoid();
  while (used.has(generated)) generated = nanoid();
  return generated;
}

function indexSnapshot(snapshot: CanvasAgentSnapshot): WorkingGraph {
  return {
    nodes: snapshot.nodes,
    connections: snapshot.connections,
    selected: snapshot.selectedNodeIds,
    viewport: snapshot.viewport,
    nodeIndex: new Map(snapshot.nodes.map((node, index) => [node.id, index])),
    nodeIds: new Set(snapshot.nodes.map((node) => node.id)),
    edgeIds: new Set(snapshot.connections.map((edge) => edge.id)),
    edges: new Set(snapshot.connections.map((edge) => `${edge.fromNodeId}\u0000${edge.toNodeId}`)),
    dirtyNodes: false,
    dirtyConnections: false,
    dirtySelection: false,
    dirtyViewport: false,
  };
}

function mutableNodes(graph: WorkingGraph) {
  if (!graph.dirtyNodes) {
    graph.nodes = [...graph.nodes];
    graph.dirtyNodes = true;
  }
  return graph.nodes;
}

function mutableConnections(graph: WorkingGraph) {
  if (!graph.dirtyConnections) {
    graph.connections = [...graph.connections];
    graph.dirtyConnections = true;
  }
  return graph.connections;
}

function insertNode(graph: WorkingGraph, operation: Extract<CanvasAgentOp, { type: "add_node" }>, sequence: number) {
  const kind = operation.nodeType && isRegisteredNodeType(operation.nodeType)
    ? operation.nodeType
    : CanvasNodeType.Text;
  const spec = getNodeSpec(kind);
  const id = uniqueId(operation.id, graph.nodeIds);
  const origin = sequence * 36;
  const position = operation.position ?? { x: operation.x ?? origin, y: operation.y ?? origin };
  const node: CanvasNodeData = {
    id,
    type: kind,
    title: operation.title?.trim() || spec.title,
    position: { x: finite(position.x, origin), y: finite(position.y, origin) },
    width: positive(operation.width ?? spec.width, spec.width),
    height: positive(operation.height ?? spec.height, spec.height),
    metadata: { ...spec.metadata, ...operation.metadata },
  };

  graph.nodeIds.add(id);
  graph.nodeIndex.set(id, graph.nodes.length);
  mutableNodes(graph).push(node);
  graph.selected = [id];
  graph.dirtySelection = true;
}

function reviseNode(graph: WorkingGraph, operation: Extract<CanvasAgentOp, { type: "update_node" }>) {
  const index = graph.nodeIndex.get(operation.id);
  if (index === undefined) return;
  const current = graph.nodes[index];
  const patch = operation.patch ?? {};
  const kind = patch.type && isRegisteredNodeType(patch.type) ? patch.type : current.type;
  const point = patch.position ?? current.position;
  const updated: CanvasNodeData = {
    ...current,
    ...patch,
    id: current.id,
    type: kind,
    position: { x: finite(point.x, current.position.x), y: finite(point.y, current.position.y) },
    width: positive(patch.width ?? current.width, current.width),
    height: positive(patch.height ?? current.height, current.height),
    metadata: { ...current.metadata, ...patch.metadata, ...operation.metadata },
  };
  if (updated === current) return;
  mutableNodes(graph)[index] = updated;
}

function removeNodes(graph: WorkingGraph, operation: Extract<CanvasAgentOp, { type: "delete_node" }>) {
  const requested = operation.ids ?? (operation.id
    ? [operation.id]
    : operation.nodeType
      ? graph.nodes.filter((node) => node.type === operation.nodeType).map((node) => node.id)
      : []);
  const removing = new Set(requested.filter((id) => graph.nodeIds.has(id)));
  if (!removing.size) return;

  for (const id of removing) {
    graph.nodeIds.delete(id);
    graph.nodeIndex.delete(id);
  }
  const nodes = mutableNodes(graph).filter((node) => !removing.has(node.id));
  graph.nodes = nodes;
  graph.nodeIndex.clear();
  nodes.forEach((node, index) => graph.nodeIndex.set(node.id, index));

  const remainingEdges = graph.connections.filter((edge) =>
    !removing.has(edge.fromNodeId) && !removing.has(edge.toNodeId),
  );
  if (remainingEdges.length !== graph.connections.length) {
    graph.connections = mutableConnections(graph);
    graph.connections = remainingEdges;
    graph.edgeIds = new Set(remainingEdges.map((edge) => edge.id));
    graph.edges = new Set(remainingEdges.map((edge) => `${edge.fromNodeId}\u0000${edge.toNodeId}`));
  }

  const selection = graph.selected.filter((id) => graph.nodeIds.has(id));
  if (selection.length !== graph.selected.length) {
    graph.selected = selection;
    graph.dirtySelection = true;
  }
}

function removeConnections(graph: WorkingGraph, operation: Extract<CanvasAgentOp, { type: "delete_connections" }>) {
  if (!graph.connections.length) return;
  const ids = operation.all ? null : new Set(operation.ids ?? (operation.id ? [operation.id] : []));
  if (ids && !ids.size) return;
  const retained = operation.all
    ? []
    : graph.connections.filter((edge) => !ids!.has(edge.id));
  if (retained.length === graph.connections.length) return;

  graph.connections = retained;
  graph.dirtyConnections = true;
  graph.edgeIds = new Set(retained.map((edge) => edge.id));
  graph.edges = new Set(retained.map((edge) => `${edge.fromNodeId}\u0000${edge.toNodeId}`));
}

function addConnection(graph: WorkingGraph, operation: Extract<CanvasAgentOp, { type: "connect_nodes" }>) {
  const { fromNodeId, toNodeId } = operation;
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
  if (!graph.nodeIds.has(fromNodeId) || !graph.nodeIds.has(toNodeId)) return;
  const pair = `${fromNodeId}\u0000${toNodeId}`;
  if (graph.edges.has(pair)) return;

  const id = uniqueId(operation.id, graph.edgeIds);
  mutableConnections(graph).push({ id, fromNodeId, toNodeId });
  graph.edgeIds.add(id);
  graph.edges.add(pair);
}

function setViewport(graph: WorkingGraph, viewport: ViewportTransform) {
  graph.viewport = {
    x: finite(viewport.x, 0),
    y: finite(viewport.y, 0),
    k: Math.min(VIEWPORT_MAX, Math.max(VIEWPORT_MIN, finite(viewport.k, 1))),
  };
  graph.dirtyViewport = true;
}

function selectNodes(graph: WorkingGraph, ids: string[]) {
  const selected = [...new Set(ids)].filter((id) => graph.nodeIds.has(id));
  if (selected.length === graph.selected.length && selected.every((id, index) => id === graph.selected[index])) return;
  graph.selected = selected;
  graph.dirtySelection = true;
}

function applyOne(graph: WorkingGraph, operation: CanvasAgentOp, sequence: number) {
  switch (operation.type) {
    case "add_node":
      insertNode(graph, operation, sequence);
      return;
    case "update_node":
      reviseNode(graph, operation);
      return;
    case "delete_node":
      removeNodes(graph, operation);
      return;
    case "delete_connections":
      removeConnections(graph, operation);
      return;
    case "connect_nodes":
      addConnection(graph, operation);
      return;
    case "set_viewport":
      setViewport(graph, operation.viewport);
      return;
    case "select_nodes":
      selectNodes(graph, operation.ids);
      return;
    case "run_generation":
      return;
  }
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, operations?: CanvasAgentOp[]) {
  const graph = indexSnapshot(snapshot);
  for (const [sequence, operation] of (operations ?? []).entries()) {
    if (operation && typeof operation.type === "string") applyOne(graph, operation, sequence);
  }

  return {
    ...snapshot,
    nodes: graph.dirtyNodes ? graph.nodes : snapshot.nodes,
    connections: graph.dirtyConnections ? graph.connections : snapshot.connections,
    selectedNodeIds: graph.dirtySelection ? graph.selected : snapshot.selectedNodeIds,
    viewport: graph.dirtyViewport ? graph.viewport : snapshot.viewport,
  };
}
