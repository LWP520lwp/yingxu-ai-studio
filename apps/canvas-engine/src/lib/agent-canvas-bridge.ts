import {
  applyCanvasAgentOps,
  type CanvasAgentOp,
  type CanvasAgentSnapshot,
} from "@/atlas-engine/agent/canvas-operations";

export type AgentGenerationRequest = {
  nodeId: string;
  mode: "text" | "image" | "video" | "audio";
  prompt: string;
};

export type AgentCanvasTransaction = {
  before: CanvasAgentSnapshot;
  after: CanvasAgentSnapshot;
  changed: boolean;
  generation: AgentGenerationRequest[];
};

const GENERATION_MODES = new Set(["text", "image", "video", "audio"]);
const OPERATION_TYPES = new Set<CanvasAgentOp["type"]>([
  "add_node",
  "update_node",
  "delete_node",
  "delete_connections",
  "connect_nodes",
  "set_viewport",
  "select_nodes",
  "run_generation",
]);

export function executeAgentCanvasTransaction(
  before: CanvasAgentSnapshot,
  operations: CanvasAgentOp[] | undefined,
): AgentCanvasTransaction {
  const mutations: CanvasAgentOp[] = [];
  const generationOps: Extract<CanvasAgentOp, { type: "run_generation" }>[] = [];

  for (const operation of Array.isArray(operations) ? operations : []) {
    if (
      !operation ||
      typeof operation.type !== "string" ||
      !OPERATION_TYPES.has(operation.type)
    )
      continue;
    if (operation.type === "run_generation") generationOps.push(operation);
    else mutations.push(operation);
  }

  const reduced = applyCanvasAgentOps(before, mutations);
  const after = {
    ...reduced,
    nodes: sameItems(before.nodes, reduced.nodes) ? before.nodes : reduced.nodes,
    connections: sameItems(before.connections, reduced.connections)
      ? before.connections
      : reduced.connections,
    selectedNodeIds: sameValues(before.selectedNodeIds, reduced.selectedNodeIds)
      ? before.selectedNodeIds
      : reduced.selectedNodeIds,
    viewport: sameViewport(before.viewport, reduced.viewport)
      ? before.viewport
      : reduced.viewport,
  };
  const generation = generationOps.flatMap((operation) => {
    const node = after.nodes.find((candidate) => candidate.id === operation.nodeId);
    if (!node) return [];

    const requestedMode = operation.mode;
    const mode = GENERATION_MODES.has(requestedMode || "")
      ? requestedMode!
      : node.metadata?.generationMode || "image";
    const prompt = operation.prompt?.trim()
      ? operation.prompt
      : node.metadata?.composerContent || node.metadata?.prompt || "";
    if (!prompt.trim()) return [];

    return [{ nodeId: node.id, mode, prompt }];
  });

  return { before, after, changed: canvasSnapshotChanged(before, after), generation };
}

function canvasSnapshotChanged(
  before: CanvasAgentSnapshot,
  after: CanvasAgentSnapshot,
) {
  return (
    !sameItems(before.nodes, after.nodes) ||
    !sameItems(before.connections, after.connections) ||
    !sameValues(before.selectedNodeIds, after.selectedNodeIds) ||
    !sameViewport(before.viewport, after.viewport)
  );
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameItems<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameViewport(
  left: CanvasAgentSnapshot["viewport"],
  right: CanvasAgentSnapshot["viewport"],
) {
  return left.x === right.x && left.y === right.y && left.k === right.k;
}
