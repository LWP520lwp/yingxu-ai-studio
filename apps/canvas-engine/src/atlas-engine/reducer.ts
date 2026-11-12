import {
  createAtlasDocument,
  type AtlasDocument,
  type AtlasEdge,
  type AtlasNode,
  type AtlasPoint,
  type AtlasRect,
  type AtlasViewport,
} from "./model";

export type AtlasCommand =
  | { type: "upsert-node"; node: AtlasNode }
  | { type: "patch-node"; id: string; patch: Partial<AtlasNode> & { frame?: Partial<AtlasRect> } }
  | { type: "remove-nodes"; ids: readonly string[] }
  | { type: "move-nodes"; ids: readonly string[]; delta: AtlasPoint }
  | { type: "connect"; edge: AtlasEdge }
  | { type: "disconnect"; edgeId: string }
  | { type: "set-viewport"; viewport: AtlasViewport }
  | { type: "select"; nodeIds: readonly string[]; edgeId?: string }
  | { type: "clear-selection" };

function bump(document: AtlasDocument, patch: Partial<AtlasDocument>): AtlasDocument {
  return { ...document, ...patch, revision: document.revision + 1 };
}

function cleanSelection(document: AtlasDocument, nodes: readonly AtlasNode[], edges: readonly AtlasEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const selected = document.selection.nodeIds.filter((id) => nodeIds.has(id));
  const edgeId = document.selection.edgeId && edgeIds.has(document.selection.edgeId)
    ? document.selection.edgeId
    : undefined;
  return { nodeIds: selected, ...(edgeId ? { edgeId } : {}) };
}

export function reduceAtlasDocument(document: AtlasDocument, command: AtlasCommand): AtlasDocument {
  switch (command.type) {
    case "upsert-node": {
      const index = document.nodes.findIndex((node) => node.id === command.node.id);
      const nodes = [...document.nodes];
      if (index < 0) nodes.push(command.node);
      else nodes[index] = command.node;
      return bump(document, { nodes });
    }
    case "patch-node": {
      const nodes = document.nodes.map((node) => {
        if (node.id !== command.id) return node;
        const frame = command.patch.frame ? { ...node.frame, ...command.patch.frame } : node.frame;
        return { ...node, ...command.patch, frame };
      });
      return nodes.some((node, index) => node !== document.nodes[index])
        ? bump(document, { nodes })
        : document;
    }
    case "remove-nodes": {
      const ids = new Set(command.ids);
      const nodes = document.nodes.filter((node) => !ids.has(node.id));
      const edges = document.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
      if (nodes.length === document.nodes.length && edges.length === document.edges.length) return document;
      return bump(document, { nodes, edges, selection: cleanSelection(document, nodes, edges) });
    }
    case "move-nodes": {
      const ids = new Set(command.ids);
      const nodes = document.nodes.map((node) => ids.has(node.id)
        ? { ...node, frame: { ...node.frame, x: node.frame.x + command.delta.x, y: node.frame.y + command.delta.y } }
        : node);
      return bump(document, { nodes });
    }
    case "connect": {
      const nodeIds = new Set(document.nodes.map((node) => node.id));
      const edge = command.edge;
      if (!edge.id || edge.source === edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return document;
      if (document.edges.some((item) => item.id === edge.id || (item.source === edge.source && item.target === edge.target))) return document;
      return bump(document, { edges: [...document.edges, edge] });
    }
    case "disconnect": {
      const edges = document.edges.filter((edge) => edge.id !== command.edgeId);
      return edges.length === document.edges.length ? document : bump(document, { edges, selection: cleanSelection(document, document.nodes, edges) });
    }
    case "set-viewport":
      return bump(document, {
        viewport: {
          x: Number.isFinite(command.viewport.x) ? command.viewport.x : document.viewport.x,
          y: Number.isFinite(command.viewport.y) ? command.viewport.y : document.viewport.y,
          zoom: Math.min(4, Math.max(0.1, Number.isFinite(command.viewport.zoom) ? command.viewport.zoom : document.viewport.zoom)),
        },
      });
    case "select": {
      const nodeIds = new Set(document.nodes.map((node) => node.id));
      const edgeIds = new Set(document.edges.map((edge) => edge.id));
      const selected = [...new Set(command.nodeIds)].filter((id) => nodeIds.has(id));
      const edgeId = command.edgeId && edgeIds.has(command.edgeId) ? command.edgeId : undefined;
      return bump(document, { selection: { nodeIds: selected, ...(edgeId ? { edgeId } : {}) } });
    }
    case "clear-selection":
      return document.selection.nodeIds.length || document.selection.edgeId
        ? bump(document, { selection: { nodeIds: [] } })
        : document;
  }
}

export function applyAtlasCommands(document: AtlasDocument, commands: readonly AtlasCommand[]): AtlasDocument {
  return commands.reduce(reduceAtlasDocument, document ?? createAtlasDocument());
}
