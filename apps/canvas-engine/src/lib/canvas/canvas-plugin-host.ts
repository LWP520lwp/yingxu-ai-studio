import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasPluginAi, CanvasPluginHost } from "@/types/canvas-plugin";

type NodeReader = () => CanvasNodeData[];
type ConnectionReader = () => CanvasConnection[];

export type CanvasPluginHostAdapterOptions = {
  readNodes: NodeReader;
  readConnections: ConnectionReader;
  setNodes: (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => void;
  setDialogNodeId: (nodeId: string | null | ((current: string | null) => string | null)) => void;
  applyOps: (ops: CanvasAgentOp[]) => void;
  ai: CanvasPluginAi;
};

type GraphIndex = {
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  nodeById: Map<string, CanvasNodeData>;
  upstream: Map<string, string[]>;
  downstream: Map<string, string[]>;
};

function createGraphIndex(nodes: CanvasNodeData[], connections: CanvasConnection[]): GraphIndex {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const upstream = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();
  const seenEdges = new Set<string>();

  for (const connection of connections) {
    const { fromNodeId, toNodeId } = connection;
    if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) continue;
    const edgeKey = `${fromNodeId}\0${toNodeId}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    const incoming = upstream.get(toNodeId);
    if (incoming) incoming.push(fromNodeId);
    else upstream.set(toNodeId, [fromNodeId]);
    const outgoing = downstream.get(fromNodeId);
    if (outgoing) outgoing.push(toNodeId);
    else downstream.set(fromNodeId, [toNodeId]);
  }

  return { nodes, connections, nodeById, upstream, downstream };
}

export function createCanvasPluginHostAdapter(options: CanvasPluginHostAdapterOptions): CanvasPluginHost {
  let graph: GraphIndex | null = null;
  const getGraph = () => {
    const nodes = options.readNodes();
    const connections = options.readConnections();
    if (!graph || graph.nodes !== nodes || graph.connections !== connections) {
      graph = createGraphIndex(nodes, connections);
    }
    return graph;
  };
  const adjacent = (index: GraphIndex, nodeIds: string[]) => {
    const unique = new Set(nodeIds);
    return [...unique].flatMap((id) => {
      const node = index.nodeById.get(id);
      return node ? [node] : [];
    });
  };

  return {
    getNode: (id) => getGraph().nodeById.get(id) || null,
    getNodes: () => options.readNodes(),
    getConnections: () => options.readConnections(),
    getUpstream: (nodeId) => {
      const index = getGraph();
      return adjacent(index, index.upstream.get(nodeId) || []);
    },
    getDownstream: (nodeId) => {
      const index = getGraph();
      return adjacent(index, index.downstream.get(nodeId) || []);
    },
    updateNode: (nodeId, patch) => options.setNodes((nodes) => {
      let changed = false;
      const next = nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const title = typeof patch.title === "string" ? patch.title : node.title;
        const width = typeof patch.width === "number" && Number.isFinite(patch.width) && patch.width > 0 ? patch.width : node.width;
        const height = typeof patch.height === "number" && Number.isFinite(patch.height) && patch.height > 0 ? patch.height : node.height;
        if (title === node.title && width === node.width && height === node.height) return node;
        changed = true;
        return { ...node, title, width, height };
      });
      return changed ? next : nodes;
    }),
    updateMetadata: (nodeId, patch) => options.setNodes((nodes) => {
      let changed = false;
      const next = nodes.map((node) => {
        if (node.id !== nodeId || !Object.keys(patch).length) return node;
        changed = true;
        const metadata: CanvasNodeMetadata = { ...node.metadata, ...patch };
        return { ...node, metadata };
      });
      return changed ? next : nodes;
    }),
    applyOps: (ops) => options.applyOps(ops),
    ai: options.ai,
    openPanel: (nodeId) => options.setDialogNodeId(nodeId),
    closePanel: (nodeId) => {
      if (!nodeId) {
        options.setDialogNodeId(null);
        return;
      }
      options.setDialogNodeId((current) => current === nodeId ? null : current);
    },
  };
}
