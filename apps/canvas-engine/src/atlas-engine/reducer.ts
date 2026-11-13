import {
  ATLAS_ZOOM_LIMITS,
  cloneAtlasData,
  createAtlasDocument,
  isValidAtlasNode,
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
  | {
      type: "replace-elements";
      nodes: readonly AtlasNode[];
      edges: readonly AtlasEdge[];
      viewport?: AtlasViewport;
      selection?: AtlasDocument["selection"];
    }
  | { type: "remove-nodes"; ids: readonly string[] }
  | { type: "move-nodes"; ids: readonly string[]; delta: AtlasPoint }
  | { type: "connect"; edge: AtlasEdge }
  | { type: "disconnect"; edgeId: string }
  | { type: "set-viewport"; viewport: AtlasViewport }
  | { type: "select"; nodeIds: readonly string[]; edgeId?: string }
  | { type: "clear-selection" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]),
  );
}

function sameRecord(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return sameValue(left, right);
}

function sameNode(left: AtlasNode, right: AtlasNode): boolean {
  return left.id === right.id &&
    left.kind === right.kind &&
    left.title === right.title &&
    left.frame.x === right.frame.x &&
    left.frame.y === right.frame.y &&
    left.frame.width === right.frame.width &&
    left.frame.height === right.frame.height &&
    sameRecord(left.data, right.data);
}

function sameNodes(left: readonly AtlasNode[], right: readonly AtlasNode[]) {
  return left.length === right.length && left.every((node, index) => sameNode(node, right[index]!));
}

function sameEdges(left: readonly AtlasEdge[], right: readonly AtlasEdge[]) {
  return left.length === right.length && left.every((edge, index) => {
    const other = right[index]!;
    return edge.id === other.id && edge.source === other.source && edge.target === other.target;
  });
}

function sameSelection(
  left: AtlasDocument["selection"],
  right: AtlasDocument["selection"],
): boolean {
  return left.edgeId === right.edgeId &&
    left.nodeIds.length === right.nodeIds.length &&
    left.nodeIds.every((id, index) => id === right.nodeIds[index]);
}

function isValidDocument(document: AtlasDocument): boolean {
  if (!document || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) return false;
  if (!Number.isInteger(document.revision) || document.revision < 0) return false;
  if (!isRecord(document.viewport) ||
      !isFiniteNumber(document.viewport.x) ||
      !isFiniteNumber(document.viewport.y) ||
      !isFiniteNumber(document.viewport.zoom) ||
      document.viewport.zoom < ATLAS_ZOOM_LIMITS.min ||
      document.viewport.zoom > ATLAS_ZOOM_LIMITS.max) return false;

  const nodeIds = new Set<string>();
  for (const node of document.nodes) {
    if (!isValidAtlasNode(node) || nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const edge of document.edges) {
    if (!isRecord(edge) || !isId(edge.id) || !isId(edge.source) || !isId(edge.target) ||
        edge.source === edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
    const pair = JSON.stringify([edge.source, edge.target]);
    if (edgeIds.has(edge.id) || pairs.has(pair)) return false;
    edgeIds.add(edge.id);
    pairs.add(pair);
  }

  if (!isRecord(document.selection) || !Array.isArray(document.selection.nodeIds)) return false;
  const selectedNodes = new Set<string>();
  for (const id of document.selection.nodeIds) {
    if (!isId(id) || !nodeIds.has(id) || selectedNodes.has(id)) return false;
    selectedNodes.add(id);
  }
  return document.selection.edgeId === undefined || edgeIds.has(document.selection.edgeId);
}

function validNodePatch(document: AtlasDocument, command: Record<string, unknown>): boolean {
  if (!isId(command.id) || !isRecord(command.patch)) return false;
  const patch = command.patch;
  if (patch.id !== undefined && patch.id !== command.id) return false;

  const current = document.nodes.find((node) => node.id === command.id);
  if (current) {
    return isValidAtlasNode({
      ...current,
      ...patch,
      id: current.id,
      frame: isRecord(patch.frame) ? { ...current.frame, ...patch.frame } : current.frame,
      ...(patch.data === undefined ? {} : { data: patch.data }),
    });
  }

  if (patch.kind !== undefined && !isId(patch.kind)) return false;
  if (patch.title !== undefined && typeof patch.title !== "string") return false;
  if (patch.data !== undefined && !isRecord(patch.data)) return false;
  if (patch.frame === undefined) return true;
  if (!isRecord(patch.frame)) return false;
  const frame = patch.frame;
  return Object.entries(frame).every(([key, value]) =>
    ["x", "y", "width", "height"].includes(key) &&
    isFiniteNumber(value) &&
    ((key !== "width" && key !== "height") || value >= 0),
  );
}

function isValidCommand(document: AtlasDocument, value: unknown): value is AtlasCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "upsert-node":
      return isValidAtlasNode(value.node);
    case "patch-node":
      return validNodePatch(document, value);
    case "replace-elements": {
      if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false;
      if (value.viewport !== undefined && (!isRecord(value.viewport) ||
          !isFiniteNumber(value.viewport.x) || !isFiniteNumber(value.viewport.y) ||
          !isFiniteNumber(value.viewport.zoom) ||
          value.viewport.zoom < ATLAS_ZOOM_LIMITS.min || value.viewport.zoom > ATLAS_ZOOM_LIMITS.max)) return false;
      if (value.selection !== undefined && (!isRecord(value.selection) ||
          !Array.isArray(value.selection.nodeIds) ||
          !value.selection.nodeIds.every(isId) ||
          (value.selection.edgeId !== undefined && !isId(value.selection.edgeId)))) return false;
      const nodeIds = new Set<string>();
      for (const node of value.nodes) {
        if (!isValidAtlasNode(node) || nodeIds.has(node.id)) return false;
        nodeIds.add(node.id);
      }
      const edgeIds = new Set<string>();
      const pairs = new Set<string>();
      for (const edge of value.edges) {
        if (!isRecord(edge) || !isId(edge.id) || !isId(edge.source) || !isId(edge.target) ||
            edge.source === edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
        const pair = JSON.stringify([edge.source, edge.target]);
        if (edgeIds.has(edge.id) || pairs.has(pair)) return false;
        edgeIds.add(edge.id);
        pairs.add(pair);
      }
      return true;
    }
    case "remove-nodes":
      return Array.isArray(value.ids) && value.ids.every(isId);
    case "move-nodes":
      return Array.isArray(value.ids) && value.ids.every(isId) &&
        isRecord(value.delta) && isFiniteNumber(value.delta.x) && isFiniteNumber(value.delta.y);
    case "connect": {
      const edge = value.edge;
      if (!isRecord(edge) || !isId(edge.id) || !isId(edge.source) || !isId(edge.target) || edge.source === edge.target) return false;
      const nodeIds = new Set(document.nodes.map((node) => node.id));
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
      return !document.edges.some((item) =>
        item.id === edge.id || (item.source === edge.source && item.target === edge.target),
      );
    }
    case "disconnect":
      return isId(value.edgeId);
    case "set-viewport":
      return isRecord(value.viewport) &&
        isFiniteNumber(value.viewport.x) &&
        isFiniteNumber(value.viewport.y) &&
        isFiniteNumber(value.viewport.zoom);
    case "select":
      return Array.isArray(value.nodeIds) && value.nodeIds.every(isId) &&
        (value.edgeId === undefined || isId(value.edgeId));
    case "clear-selection":
      return true;
    default:
      return false;
  }
}

function bump(document: AtlasDocument, patch: Partial<AtlasDocument>): AtlasDocument {
  return { ...document, ...patch, revision: document.revision + 1 };
}

function cleanSelection(
  document: AtlasDocument,
  nodes: readonly AtlasNode[],
  edges: readonly AtlasEdge[],
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const selected = [...new Set(document.selection.nodeIds.filter((id) => nodeIds.has(id)))];
  const edgeId = document.selection.edgeId && edgeIds.has(document.selection.edgeId)
    ? document.selection.edgeId
    : undefined;
  return { nodeIds: selected, ...(edgeId ? { edgeId } : {}) };
}

export function reduceAtlasDocument(
  document: AtlasDocument,
  command: AtlasCommand,
): AtlasDocument {
  if (!isValidDocument(document) || !isValidCommand(document, command)) return document;

  switch (command.type) {
    case "upsert-node": {
      const index = document.nodes.findIndex((node) => node.id === command.node.id);
      const nextNode: AtlasNode = {
        ...command.node,
        frame: { ...command.node.frame },
        ...(command.node.data ? { data: cloneAtlasData(command.node.data) } : {}),
      };
      if (index < 0) return bump(document, { nodes: [...document.nodes, nextNode] });
      if (sameNode(document.nodes[index]!, nextNode)) return document;
      const nodes = [...document.nodes];
      nodes[index] = nextNode;
      return bump(document, { nodes });
    }
    case "patch-node": {
      const index = document.nodes.findIndex((node) => node.id === command.id);
      if (index < 0) return document;
      const current = document.nodes[index]!;
      const patchedData = command.patch.data === undefined
        ? current.data
        : cloneAtlasData(command.patch.data);
      const nextNode: AtlasNode = {
        ...current,
        ...command.patch,
        id: current.id,
        frame: command.patch.frame
          ? { ...current.frame, ...command.patch.frame }
          : current.frame,
        ...(patchedData ? { data: patchedData } : {}),
      };
      if (sameNode(current, nextNode)) return document;
      const nodes = [...document.nodes];
      nodes[index] = nextNode;
      return bump(document, { nodes });
    }
    case "replace-elements": {
      const previousNodes = new Map(document.nodes.map((node) => [node.id, node]));
      const nodes = command.nodes.map((candidate) => {
        const previous = previousNodes.get(candidate.id);
        if (previous && sameNode(previous, candidate)) return previous;
        return {
          ...candidate,
          frame: { ...candidate.frame },
          ...(candidate.data ? { data: cloneAtlasData(candidate.data) } : {}),
        };
      });
      const previousEdges = new Map(document.edges.map((edge) => [edge.id, edge]));
      const edges = command.edges.map((candidate) => {
        const previous = previousEdges.get(candidate.id);
        return previous && previous.source === candidate.source && previous.target === candidate.target
          ? previous
          : { ...candidate };
      });
      const selection = cleanSelection(
        document,
        nodes,
        edges,
      );
      const nextSelection = command.selection
        ? cleanSelection(
            { ...document, selection: command.selection },
            nodes,
            edges,
          )
        : selection;
      const viewport = command.viewport
        ? {
            x: command.viewport.x,
            y: command.viewport.y,
            zoom: Math.min(ATLAS_ZOOM_LIMITS.max, Math.max(ATLAS_ZOOM_LIMITS.min, command.viewport.zoom)),
          }
        : document.viewport;
      if (sameNodes(document.nodes, nodes) && sameEdges(document.edges, edges) &&
          sameSelection(document.selection, nextSelection) &&
          document.viewport.x === viewport.x && document.viewport.y === viewport.y &&
          document.viewport.zoom === viewport.zoom) return document;
      return bump(document, { nodes, edges, selection: nextSelection, viewport });
    }
    case "remove-nodes": {
      const ids = new Set(command.ids);
      const nodes = document.nodes.flatMap((node) => {
        if (ids.has(node.id)) return [];
        if (!ids.has(String(node.data?.groupId ?? ""))) return [node];
        return [{ ...node, data: { ...node.data, groupId: undefined } }];
      });
      const edges = document.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
      if (nodes.every((node, index) => node === document.nodes[index]) && edges.length === document.edges.length) return document;
      return bump(document, { nodes, edges, selection: cleanSelection(document, nodes, edges) });
    }
    case "move-nodes": {
      if (command.delta.x === 0 && command.delta.y === 0) return document;
      const ids = new Set(command.ids);
      let changed = false;
      const nodes = document.nodes.map((node) => {
        if (!ids.has(node.id)) return node;
        const x = node.frame.x + command.delta.x;
        const y = node.frame.y + command.delta.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return node;
        changed = true;
        return { ...node, frame: { ...node.frame, x, y } };
      });
      if (!changed) return document;
      if (nodes.some((node, index) => ids.has(node.id) && node === document.nodes[index])) return document;
      return bump(document, { nodes });
    }
    case "connect":
      return bump(document, { edges: [...document.edges, { ...command.edge }] });
    case "disconnect": {
      const edges = document.edges.filter((edge) => edge.id !== command.edgeId);
      if (edges.length === document.edges.length) return document;
      return bump(document, { edges, selection: cleanSelection(document, document.nodes, edges) });
    }
    case "set-viewport": {
      const viewport = {
        x: command.viewport.x,
        y: command.viewport.y,
        zoom: Math.min(ATLAS_ZOOM_LIMITS.max, Math.max(ATLAS_ZOOM_LIMITS.min, command.viewport.zoom)),
      };
      if (viewport.x === document.viewport.x && viewport.y === document.viewport.y && viewport.zoom === document.viewport.zoom) return document;
      return bump(document, { viewport });
    }
    case "select": {
      const nodeIds = new Set(document.nodes.map((node) => node.id));
      const edgeIds = new Set(document.edges.map((edge) => edge.id));
      const selected = [...new Set(command.nodeIds)].filter((id) => nodeIds.has(id));
      const edgeId = command.edgeId && edgeIds.has(command.edgeId)
        ? command.edgeId
        : undefined;
      const selection = { nodeIds: selected, ...(edgeId ? { edgeId } : {}) };
      if (sameSelection(document.selection, selection)) return document;
      return bump(document, { selection });
    }
    case "clear-selection":
      return document.selection.nodeIds.length || document.selection.edgeId
        ? bump(document, { selection: { nodeIds: [] } })
        : document;
  }
}

export function applyAtlasCommands(
  document: AtlasDocument,
  commands: readonly AtlasCommand[],
): AtlasDocument {
  if (!isValidDocument(document) || !Array.isArray(commands)) return document;

  let next = document;
  for (const command of commands) {
    if (!isValidCommand(next, command)) return document;
    next = reduceAtlasDocument(next, command);
  }
  return next;
}

export function createEmptyAtlasDocument(): AtlasDocument {
  return createAtlasDocument();
}
