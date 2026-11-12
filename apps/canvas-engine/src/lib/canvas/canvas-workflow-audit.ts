import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasWorkflowIssueCode =
  | "missing-source"
  | "missing-target"
  | "self-link"
  | "duplicate-link"
  | "cycle";

export type CanvasWorkflowIssue = {
  code: CanvasWorkflowIssueCode;
  severity: "error" | "warning";
  connectionId: string;
  focusNodeId?: string;
  fromTitle?: string;
  toTitle?: string;
};

export type CanvasWorkflowSummary = {
  entryNodes: CanvasNodeData[];
  exitNodes: CanvasNodeData[];
  isolatedNodes: CanvasNodeData[];
  branchNodes: CanvasNodeData[];
};

/** Describe the usable flow shape without treating cycles as malformed data. */
export function summarizeCanvasWorkflow(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
): CanvasWorkflowSummary {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const seen = new Set<string>();

  for (const edge of connections) {
    if (
      !nodeById.has(edge.fromNodeId) ||
      !nodeById.has(edge.toNodeId) ||
      edge.fromNodeId === edge.toNodeId
    )
      continue;
    const pair = `${edge.fromNodeId}\0${edge.toNodeId}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    outgoing.set(edge.fromNodeId, (outgoing.get(edge.fromNodeId) || 0) + 1);
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) || 0) + 1);
  }

  const entryNodes: CanvasNodeData[] = [];
  const exitNodes: CanvasNodeData[] = [];
  const isolatedNodes: CanvasNodeData[] = [];
  const branchNodes: CanvasNodeData[] = [];
  for (const node of nodes) {
    const inputCount = incoming.get(node.id) || 0;
    const outputCount = outgoing.get(node.id) || 0;
    if (inputCount === 0) entryNodes.push(node);
    if (outputCount === 0) exitNodes.push(node);
    if (inputCount === 0 && outputCount === 0) isolatedNodes.push(node);
    if (outputCount > 1) branchNodes.push(node);
  }
  return { entryNodes, exitNodes, isolatedNodes, branchNodes };
}

/** Remove only structurally invalid edges. Intentional cycles remain reviewable. */
export function repairCanvasConnections(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
) {
  const ids = new Set(nodes.map((node) => node.id));
  const targetsBySource = new Map<string, Set<string>>();
  const kept: CanvasConnection[] = [];
  for (const edge of connections) {
    if (
      !ids.has(edge.fromNodeId) ||
      !ids.has(edge.toNodeId) ||
      edge.fromNodeId === edge.toNodeId
    )
      continue;
    const targets = targetsBySource.get(edge.fromNodeId) || new Set<string>();
    if (targets.has(edge.toNodeId)) continue;
    targets.add(edge.toNodeId);
    targetsBySource.set(edge.fromNodeId, targets);
    kept.push(edge);
  }
  return kept;
}

export function auditCanvasWorkflow(
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
): CanvasWorkflowIssue[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const issues: CanvasWorkflowIssue[] = [];
  const firstConnectionByPair = new Map<string, string>();
  const validEdges: CanvasConnection[] = [];

  for (const connection of connections) {
    const from = nodeById.get(connection.fromNodeId);
    const to = nodeById.get(connection.toNodeId);
    if (!from || !to) {
      issues.push({
        code: !from ? "missing-source" : "missing-target",
        severity: "error",
        connectionId: connection.id,
        focusNodeId: from?.id ?? to?.id,
        fromTitle: from?.title,
        toTitle: to?.title,
      });
      continue;
    }

    if (from.id === to.id) {
      issues.push({
        code: "self-link",
        severity: "error",
        connectionId: connection.id,
        focusNodeId: from.id,
        fromTitle: from.title,
        toTitle: to.title,
      });
      continue;
    }

    const pair = `${from.id}\0${to.id}`;
    if (firstConnectionByPair.has(pair)) {
      issues.push({
        code: "duplicate-link",
        severity: "warning",
        connectionId: connection.id,
        focusNodeId: from.id,
        fromTitle: from.title,
        toTitle: to.title,
      });
      continue;
    }
    firstConnectionByPair.set(pair, connection.id);
    validEdges.push(connection);
  }

  const outgoing = new Map<string, CanvasConnection[]>();
  for (const edge of validEdges) {
    const edges = outgoing.get(edge.fromNodeId);
    if (edges) edges.push(edge);
    else outgoing.set(edge.fromNodeId, [edge]);
  }

  const state = new Map<string, 0 | 1 | 2>();
  for (const root of nodes) {
    if (state.has(root.id)) continue;
    state.set(root.id, 1);
    const stack = [
      { nodeId: root.id, edges: outgoing.get(root.id) || [], nextEdge: 0 },
    ];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const edge = frame.edges[frame.nextEdge];
      if (!edge) {
        state.set(frame.nodeId, 2);
        stack.pop();
        continue;
      }
      frame.nextEdge += 1;
      const nextState = state.get(edge.toNodeId) || 0;
      if (nextState === 1) {
        const from = nodeById.get(edge.fromNodeId);
        const to = nodeById.get(edge.toNodeId);
        issues.push({
          code: "cycle",
          severity: "warning",
          connectionId: edge.id,
          focusNodeId: from?.id,
          fromTitle: from?.title,
          toTitle: to?.title,
        });
      } else if (nextState === 0) {
        state.set(edge.toNodeId, 1);
        stack.push({
          nodeId: edge.toNodeId,
          edges: outgoing.get(edge.toNodeId) || [],
          nextEdge: 0,
        });
      }
    }
  }
  return issues;
}
