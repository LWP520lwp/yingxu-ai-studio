import type { CanvasAgentOp } from "@/atlas-engine/agent/canvas-operations";
import type {
  CanvasConnection,
  CanvasNodeData,
  CanvasNodeMetadata,
} from "@/types/canvas";
import type { CanvasPluginAi, CanvasPluginHost } from "@/types/canvas-plugin";

type NodeReader = () => CanvasNodeData[];
type ConnectionReader = () => CanvasConnection[];

export type AtlasPluginHostOptions = {
  readNodes: NodeReader;
  readConnections: ConnectionReader;
  setNodes: (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => void;
  setDialogNodeId: (
    nodeId: string | null | ((current: string | null) => string | null),
  ) => void;
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

function indexGraph(
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
): GraphIndex {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const upstream = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();
  const seen = new Set<string>();

  for (const edge of connections) {
    if (!nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)) continue;
    const identity = `${edge.fromNodeId}\0${edge.toNodeId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    upstream.set(edge.toNodeId, [...(upstream.get(edge.toNodeId) ?? []), edge.fromNodeId]);
    downstream.set(edge.fromNodeId, [...(downstream.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  }

  return { nodes, connections, nodeById, upstream, downstream };
}

function resolveNodes(index: GraphIndex, ids: readonly string[]) {
  return ids.flatMap((id) => {
    const node = index.nodeById.get(id);
    return node ? [node] : [];
  });
}

export function createAtlasPluginHost(options: AtlasPluginHostOptions): CanvasPluginHost {
  let cached: GraphIndex | undefined;
  const graph = () => {
    const nodes = options.readNodes();
    const connections = options.readConnections();
    if (cached?.nodes !== nodes || cached.connections !== connections) {
      cached = indexGraph(nodes, connections);
    }
    return cached;
  };

  return {
    getNode: (id) => graph().nodeById.get(id) ?? null,
    getNodes: options.readNodes,
    getConnections: options.readConnections,
    getUpstream: (id) => {
      const current = graph();
      return resolveNodes(current, current.upstream.get(id) ?? []);
    },
    getDownstream: (id) => {
      const current = graph();
      return resolveNodes(current, current.downstream.get(id) ?? []);
    },
    updateNode: (id, patch) => options.setNodes((nodes) => {
      let changed = false;
      const next = nodes.map((node) => {
        if (node.id !== id) return node;
        const title = typeof patch.title === "string" ? patch.title : node.title;
        const width = Number.isFinite(patch.width) && (patch.width ?? 0) > 0 ? patch.width! : node.width;
        const height = Number.isFinite(patch.height) && (patch.height ?? 0) > 0 ? patch.height! : node.height;
        if (title === node.title && width === node.width && height === node.height) return node;
        changed = true;
        return { ...node, title, width, height };
      });
      return changed ? next : nodes;
    }),
    updateMetadata: (id, patch) => options.setNodes((nodes) => {
      let changed = false;
      const next = nodes.map((node) => {
        if (node.id !== id || Object.keys(patch).length === 0) return node;
        changed = true;
        const metadata: CanvasNodeMetadata = { ...node.metadata, ...patch };
        return { ...node, metadata };
      });
      return changed ? next : nodes;
    }),
    applyOps: options.applyOps,
    ai: options.ai,
    openPanel: options.setDialogNodeId,
    closePanel: (id) => {
      if (!id) {
        options.setDialogNodeId(null);
        return;
      }
      options.setDialogNodeId((current) => current === id ? null : current);
    },
  };
}
