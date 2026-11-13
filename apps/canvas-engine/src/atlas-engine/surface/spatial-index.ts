/** Spatial queries used by the Atlas canvas surface and its host adapter. */
import { routeCanvasConnection } from "@/atlas-engine/surface/connection-routing";
import { screenToWorld } from "@/atlas-engine/surface/geometry";
import { clampCanvasZoom } from "@/atlas-engine/surface/viewport";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type ViewportTransform,
} from "@/types/canvas";

export type CanvasViewBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type VisibleConnection = {
  connection: CanvasConnection;
  from: CanvasNodeData;
  to: CanvasNodeData;
};

type SpatialEntry<T> = { value: T; bounds: CanvasViewBounds; order: number };
type SpatialGrid<T> = {
  entries: SpatialEntry<T>[];
  buckets: Map<string, number[]>;
  overflow: number[];
  query: (bounds: CanvasViewBounds) => SpatialEntry<T>[];
};

export type CanvasViewIndex = {
  nodeById: Map<string, CanvasNodeData>;
  nodeOrder: Map<string, number>;
  nodes: SpatialGrid<CanvasNodeData>;
  connections: SpatialGrid<VisibleConnection>;
};

function connectionBox(node: CanvasNodeData) {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
  };
}

const SPATIAL_CELL_SIZE = 1024;
const MAX_ENTRY_CELLS = 32;
const MAX_QUERY_CELLS = 256;

function cellRange(bounds: CanvasViewBounds) {
  if (
    ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(
      Number.isFinite,
    )
  )
    return null;
  const minX = Math.floor(
    Math.min(bounds.left, bounds.right) / SPATIAL_CELL_SIZE,
  );
  const minY = Math.floor(
    Math.min(bounds.top, bounds.bottom) / SPATIAL_CELL_SIZE,
  );
  const maxX = Math.floor(
    Math.max(bounds.left, bounds.right) / SPATIAL_CELL_SIZE,
  );
  const maxY = Math.floor(
    Math.max(bounds.top, bounds.bottom) / SPATIAL_CELL_SIZE,
  );
  if (![minX, minY, maxX, maxY].every(Number.isSafeInteger)) return null;
  const cells = (maxX - minX + 1) * (maxY - minY + 1);
  return { minX, minY, maxX, maxY, cells };
}

function cellKey(x: number, y: number) {
  return `${x}:${y}`;
}

function intersectsBounds(left: CanvasViewBounds, right: CanvasViewBounds) {
  return (
    left.right >= right.left &&
    left.left <= right.right &&
    left.bottom >= right.top &&
    left.top <= right.bottom
  );
}

function createSpatialGrid<T>(entries: SpatialEntry<T>[]): SpatialGrid<T> {
  const buckets = new Map<string, number[]>();
  const overflow: number[] = [];

  entries.forEach((entry, index) => {
    const range = cellRange(entry.bounds);
    if (!range || range.cells > MAX_ENTRY_CELLS) {
      overflow.push(index);
      return;
    }
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const key = cellKey(x, y);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      }
    }
  });

  return {
    entries,
    buckets,
    overflow,
    query(bounds) {
      const range = cellRange(bounds);
      if (!range || range.cells > MAX_QUERY_CELLS)
        return entries.filter((entry) =>
          intersectsBounds(entry.bounds, bounds),
        );

      const found = new Set(overflow);
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          for (const index of buckets.get(cellKey(x, y)) || [])
            found.add(index);
        }
      }
      return [...found]
        .sort((left, right) => entries[left].order - entries[right].order)
        .map((index) => entries[index])
        .filter((entry) => intersectsBounds(entry.bounds, bounds));
    },
  };
}

export function canvasViewBounds(
  viewport: ViewportTransform,
  size: { width: number; height: number },
  padding = 280,
): CanvasViewBounds {
  const scale = clampCanvasZoom(viewport.k);
  const gutter = Math.max(0, Number.isFinite(padding) ? padding : 0);
  const origin = screenToWorld(
    {
      x: Number.isFinite(viewport.x) ? viewport.x : 0,
      y: Number.isFinite(viewport.y) ? viewport.y : 0,
      scale,
    },
    { x: 0, y: 0 },
  );
  const left = origin.x - gutter;
  const top = origin.y - gutter;
  const width =
    Math.max(0, Number.isFinite(size.width) ? size.width : 0) / scale;
  const height =
    Math.max(0, Number.isFinite(size.height) ? size.height : 0) / scale;
  return {
    left,
    top,
    right: left + width + gutter * 2,
    bottom: top + height + gutter * 2,
  };
}

export function indexCanvasNodes(nodes: CanvasNodeData[]) {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function createCanvasViewIndex(
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
  nodeById = indexCanvasNodes(nodes),
): CanvasViewIndex {
  const nodeEntries = nodes.flatMap((node, order) => {
    const bounds = {
      left: node.position.x,
      top: node.position.y,
      right: node.position.x + node.width,
      bottom: node.position.y + node.height,
    };
    return Object.values(bounds).every(Number.isFinite)
      ? [{ value: node, bounds, order }]
      : [];
  });
  const nodeOrder = new Map(
    nodeEntries.map((entry) => [entry.value.id, entry.order]),
  );
  const connectionEntries = connections.flatMap((connection, order) => {
    const from = nodeById.get(connection.fromNodeId);
    const to = nodeById.get(connection.toNodeId);
    if (!from || !to) return [];
    const curve = routeCanvasConnection(connectionBox(from), connectionBox(to));
    const bounds = cubicCurveBounds(
      curve.start,
      curve.control1,
      curve.control2,
      curve.end,
    );
    if (!Object.values(bounds).every(Number.isFinite)) return [];
    return [{ value: { connection, from, to }, bounds, order }];
  });

  return {
    nodeById,
    nodeOrder,
    nodes: createSpatialGrid(nodeEntries),
    connections: createSpatialGrid(connectionEntries),
  };
}

export function selectVisibleNodes(
  nodes: CanvasNodeData[],
  bounds: CanvasViewBounds,
  keepMountedId?: string | null,
  viewIndex?: CanvasViewIndex,
) {
  const candidates = viewIndex
    ? viewIndex.nodes.query(bounds).map((entry) => entry.value)
    : nodes;
  const visible = candidates.filter(
    (node) =>
      node.id === keepMountedId ||
      (node.position.x + node.width > bounds.left &&
        node.position.x < bounds.right &&
        node.position.y + node.height > bounds.top &&
        node.position.y < bounds.bottom),
  );
  if (!keepMountedId || visible.some((node) => node.id === keepMountedId))
    return visible;
  const keepMounted =
    viewIndex?.nodeById.get(keepMountedId) ||
    nodes.find((node) => node.id === keepMountedId);
  if (!keepMounted) return visible;
  const nodeOrder = viewIndex?.nodeOrder;
  const keepOrder = nodeOrder?.get(keepMountedId);
  if (!nodeOrder || keepOrder === undefined) return [...visible, keepMounted];
  const insertionPoint = visible.findIndex(
    (node) => (nodeOrder.get(node.id) ?? Infinity) > keepOrder,
  );
  if (insertionPoint < 0) return [...visible, keepMounted];
  return [
    ...visible.slice(0, insertionPoint),
    keepMounted,
    ...visible.slice(insertionPoint),
  ];
}

export function selectVisibleConnections(
  connections: CanvasConnection[],
  nodeById: Map<string, CanvasNodeData>,
  bounds: CanvasViewBounds,
  viewIndex?: CanvasViewIndex,
): VisibleConnection[] {
  if (viewIndex)
    return viewIndex.connections.query(bounds).map((entry) => entry.value);
  return connections.flatMap((connection) => {
    const from = nodeById.get(connection.fromNodeId);
    const to = nodeById.get(connection.toNodeId);
    if (!from || !to) return [];
    const curve = routeCanvasConnection(connectionBox(from), connectionBox(to));
    const curveBounds = cubicCurveBounds(
      curve.start,
      curve.control1,
      curve.control2,
      curve.end,
    );
    const intersects =
      curveBounds.right >= bounds.left &&
      curveBounds.left <= bounds.right &&
      curveBounds.bottom >= bounds.top &&
      curveBounds.top <= bounds.bottom;
    return intersects ? [{ connection, from, to }] : [];
  });
}

function cubicCoordinate(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
) {
  const u = 1 - t;
  return (
    u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
  );
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-9)
    return Math.abs(b) < 1e-9 ? [] : [-c / b].filter((t) => t > 0 && t < 1);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter(
    (t) => t > 0 && t < 1,
  );
}

function cubicCurveBounds(
  start: { x: number; y: number },
  control1: { x: number; y: number },
  control2: { x: number; y: number },
  end: { x: number; y: number },
): CanvasViewBounds {
  const xPoints = [
    start.x,
    end.x,
    ...cubicExtrema(start.x, control1.x, control2.x, end.x).map((t) =>
      cubicCoordinate(start.x, control1.x, control2.x, end.x, t),
    ),
  ];
  const yPoints = [
    start.y,
    end.y,
    ...cubicExtrema(start.y, control1.y, control2.y, end.y).map((t) =>
      cubicCoordinate(start.y, control1.y, control2.y, end.y, t),
    ),
  ];
  return {
    left: Math.min(...xPoints),
    right: Math.max(...xPoints),
    top: Math.min(...yPoints),
    bottom: Math.max(...yPoints),
  };
}

export function countCanvasGroupChildren(nodes: CanvasNodeData[]) {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const groupId = node.metadata?.groupId;
    if (groupId) counts.set(groupId, (counts.get(groupId) || 0) + 1);
  }
  return counts;
}

export function relatedCanvasElements(
  activeNodeId: string | null,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
  nodeById: Map<string, CanvasNodeData>,
) {
  const nodeIds = new Set<string>();
  const connectionIds = new Set<string>();
  if (!activeNodeId) return { nodeIds, connectionIds };
  const childrenByGroup = new Map<string, CanvasNodeData[]>();
  for (const node of nodes) {
    const groupId = node.metadata?.groupId;
    if (!groupId) continue;
    const children = childrenByGroup.get(groupId);
    if (children) children.push(node);
    else childrenByGroup.set(groupId, [node]);
  }
  const addNode = (nodeId: string) => {
    nodeIds.add(nodeId);
    if (nodeById.get(nodeId)?.type === CanvasNodeType.Group) {
      const queue = [nodeId];
      const visited = new Set<string>();
      while (queue.length) {
        const groupId = queue.shift()!;
        if (visited.has(groupId)) continue;
        visited.add(groupId);
        for (const child of childrenByGroup.get(groupId) || []) {
          if (nodeIds.has(child.id)) continue;
          nodeIds.add(child.id);
          if (child.type === CanvasNodeType.Group) queue.push(child.id);
        }
      }
    }
  };
  addNode(activeNodeId);
  for (const connection of connections) {
    if (
      connection.fromNodeId !== activeNodeId &&
      connection.toNodeId !== activeNodeId
    )
      continue;
    connectionIds.add(connection.id);
    addNode(connection.fromNodeId);
    addNode(connection.toNodeId);
  }
  return { nodeIds, connectionIds };
}

export function connectedSourcesByTarget(
  connections: CanvasConnection[],
  nodeById: Map<string, CanvasNodeData>,
) {
  const connected = new Map<string, CanvasNodeData[]>();
  const seenByTarget = new Map<string, Set<string>>();
  for (const connection of connections) {
    const source = nodeById.get(connection.fromNodeId);
    if (!source) continue;
    let seen = seenByTarget.get(connection.toNodeId);
    if (!seen) {
      seen = new Set();
      seenByTarget.set(connection.toNodeId, seen);
    }
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    const targetSources = connected.get(connection.toNodeId);
    if (targetSources) targetSources.push(source);
    else connected.set(connection.toNodeId, [source]);
  }
  return connected;
}
