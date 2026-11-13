import { nanoid } from "nanoid";

import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type CanvasNodeMetadata,
  type Position,
} from "@/types/canvas";
import { fitAtlasNodeSize } from "@/atlas-engine/model/node-size";
import { patchAtlasNodeConfig } from "@/atlas-engine/model/node-factory";
import { canvasGroupFrame } from "./canvas-group-adapter";

export type AtlasNodeCommand = { nodeId: string } & (
  | { kind: "title" | "prompt" | "content"; value: string }
  | { kind: "font-size"; value: number }
  | { kind: "resize"; width: number; height: number; position?: Position }
  | { kind: "toggle-free-resize" }
  | { kind: "config"; patch: Partial<CanvasNodeData["metadata"]> }
  | { kind: "select-variant" | "remove-variant"; variantId: string }
);

function samePatch(node: CanvasNodeData, patch: Partial<CanvasNodeMetadata>) {
  return Object.entries(patch).every(([key, value]) =>
    Object.is(node.metadata?.[key as keyof CanvasNodeMetadata], value),
  );
}

function withMetadata(
  node: CanvasNodeData,
  patch: Partial<CanvasNodeMetadata>,
) {
  return samePatch(node, patch)
    ? node
    : { ...node, metadata: { ...node.metadata, ...patch } };
}

function selectImage(node: CanvasNodeData, variantId: string) {
  const image = node.metadata?.images?.find((item) => item.id === variantId);
  if (!image?.content) return node;

  const bound = Math.max(node.width, node.height);
  const size = node.metadata?.freeResize
    ? { width: node.width, height: node.height }
    : fitAtlasNodeSize(image.naturalWidth, image.naturalHeight, bound, bound);
  const x = node.position.x + (node.width - size.width) / 2;
  const y = node.position.y + (node.height - size.height) / 2;

  return {
    ...node,
    ...size,
    position: { x, y },
    metadata: {
      ...node.metadata,
      content: image.content,
      storageKey: image.storageKey,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      bytes: image.bytes,
      mimeType: image.mimeType,
      primaryImageId: image.id,
    },
  };
}

function selectVariant(node: CanvasNodeData, variantId: string) {
  if (node.type !== CanvasNodeType.Text) return selectImage(node, variantId);
  const text = node.metadata?.texts?.find((item) => item.id === variantId);
  return text?.content
    ? withMetadata(node, { content: text.content, primaryTextId: text.id })
    : node;
}

function removeVariant(node: CanvasNodeData, variantId: string) {
  const isText = node.type === CanvasNodeType.Text;
  const variants = isText ? node.metadata?.texts : node.metadata?.images;
  if (!variants?.some((item) => item.id === variantId)) return node;

  if (isText) {
    const texts = node.metadata!.texts!.filter((item) => item.id !== variantId);
    const updated = withMetadata(node, { texts, textCount: texts.length });
    if (node.metadata?.primaryTextId !== variantId) return updated;
    const nextPrimary = texts.find((item) => Boolean(item.content));
    return nextPrimary
      ? selectVariant(updated, nextPrimary.id)
      : withMetadata(updated, { content: "", primaryTextId: undefined });
  }

  const images = node.metadata!.images!.filter((item) => item.id !== variantId);
  const updated = withMetadata(node, { images, count: images.length });
  if (node.metadata?.primaryImageId !== variantId) return updated;
  const nextPrimary = images.find((item) => Boolean(item.content));
  if (nextPrimary) return selectImage(updated, nextPrimary.id);

  return withMetadata(updated, {
    content: undefined,
    primaryImageId: undefined,
    storageKey: undefined,
    naturalWidth: undefined,
    naturalHeight: undefined,
    bytes: undefined,
    mimeType: undefined,
    status: images.some((item) => item.status === "loading")
      ? "loading"
      : images.some((item) => item.status === "error")
        ? "error"
        : "idle",
  });
}

function editNode(
  node: CanvasNodeData,
  command: AtlasNodeCommand,
): CanvasNodeData {
  switch (command.kind) {
    case "title":
      return node.title === command.value
        ? node
        : { ...node, title: command.value };
    case "prompt":
      return withMetadata(node, { prompt: command.value });
    case "content": {
      const primaryTextId = node.metadata?.primaryTextId;
      const texts = node.metadata?.texts;
      const primaryText = texts?.find((item) => item.id === primaryTextId);
      return withMetadata(node, {
        content: command.value,
        ...(primaryText && primaryText.content !== command.value
          ? {
              texts: texts!.map((item) =>
                item.id === primaryTextId
                  ? { ...item, content: command.value }
                  : item,
              ),
            }
          : {}),
      });
    }
    case "font-size":
      return Number.isFinite(command.value) && command.value > 0
        ? withMetadata(node, { fontSize: command.value })
        : node;
    case "config":
      return patchAtlasNodeConfig(node, command.patch ?? {});
    case "select-variant":
      return selectVariant(node, command.variantId);
    case "remove-variant":
      return removeVariant(node, command.variantId);
    case "resize": {
      const { width, height } = command;
      const position = command.position ?? node.position;
      if (
        ![width, height, position.x, position.y].every(Number.isFinite) ||
        width <= 0 ||
        height <= 0
      )
        return node;
      return node.width === width &&
        node.height === height &&
        node.position.x === position.x &&
        node.position.y === position.y
        ? node
        : { ...node, width, height, position: { ...position } };
    }
    case "toggle-free-resize": {
      const freeResize = !node.metadata?.freeResize;
      const updated = withMetadata(node, { freeResize });
      if (freeResize || node.type !== CanvasNodeType.Image) return updated;
      const naturalWidth = node.metadata?.naturalWidth || node.width;
      const naturalHeight = node.metadata?.naturalHeight || node.height || 1;
      const height = (node.width * naturalHeight) / naturalWidth;
      return Number.isFinite(height) && height > 0
        ? {
            ...updated,
            height,
            position: {
              x: node.position.x,
              y: node.position.y + (node.height - height) / 2,
            },
          }
        : updated;
    }
  }
}

/** Applies one immutable edit and preserves array identity when it changes nothing. */
export function applyAtlasNodeCommand(
  nodes: CanvasNodeData[],
  command: AtlasNodeCommand,
): CanvasNodeData[] {
  const index = nodes.findIndex((node) => node.id === command.nodeId);
  if (index < 0) return nodes;
  const changed = editNode(nodes[index], command);
  if (changed === nodes[index]) return nodes;
  const result = nodes.slice();
  result[index] = changed;
  return result;
}

export type AtlasCanvasFragment = Readonly<{
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
}>;

type AtlasFragmentPlacement =
  { center: Position; offset?: never } | { offset: Position; center?: never };

export type AtlasFragmentOptions = AtlasFragmentPlacement & {
  existingNodes: readonly CanvasNodeData[];
  preserveExternalGroups?: boolean;
  idFactory?: () => string;
  copySuffix?: string;
};

/** Takes a detached graph snapshot, expanding selected groups through descendants. */
export function captureAtlasFragment(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
  selectedIds: ReadonlySet<string>,
): AtlasCanvasFragment | null {
  if (!selectedIds.size) return null;
  const index = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    const parent = node.metadata?.groupId;
    if (parent)
      children.set(parent, [...(children.get(parent) ?? []), node.id]);
  }

  const included = new Set<string>();
  const queue = [...selectedIds];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    if (included.has(nodeId)) continue;
    const node = index.get(nodeId);
    if (!node) continue;
    included.add(nodeId);
    if (node.type === CanvasNodeType.Group)
      queue.push(...(children.get(nodeId) ?? []));
  }
  if (!included.size) return null;

  const snapshot = {
    nodes: nodes.filter((node) => included.has(node.id)),
    connections: connections.filter(
      (edge) => included.has(edge.toNodeId) && index.has(edge.fromNodeId),
    ),
  };
  return structuredClone(snapshot);
}

function clonedMetadata(
  source: CanvasNodeData,
  idMap: ReadonlyMap<string, string>,
  existing: ReadonlyMap<string, CanvasNodeData>,
  preserveExternalGroups: boolean,
): CanvasNodeMetadata | undefined {
  if (!source.metadata) return undefined;
  const metadata = structuredClone(source.metadata);
  if (metadata.groupId) {
    const externalGroup = existing.get(metadata.groupId);
    metadata.groupId =
      idMap.get(metadata.groupId) ??
      (preserveExternalGroups && externalGroup?.type === CanvasNodeType.Group
        ? externalGroup.id
        : undefined);
  }

  if (metadata.status === "loading")
    metadata.status = metadata.content ? "success" : "idle";
  delete metadata.videoTaskId;
  delete metadata.videoTaskProjectId;
  delete metadata.videoTaskProvider;
  for (const item of [...(metadata.images ?? []), ...(metadata.texts ?? [])]) {
    if (item.status === "loading")
      item.status = item.content ? "success" : "idle";
  }
  if (metadata.composition) {
    metadata.composition.clips = metadata.composition.clips.map((clip) => ({
      ...clip,
      sourceNodeId: idMap.get(clip.sourceNodeId) ?? clip.sourceNodeId,
    }));
  }
  return metadata;
}

/** Creates a new independent graph at a center point or relative offset. */
export function placeAtlasFragment(
  fragment: AtlasCanvasFragment,
  options: AtlasFragmentOptions,
): AtlasCanvasFragment {
  if (!fragment.nodes.length) return { nodes: [], connections: [] };
  const makeId = options.idFactory ?? nanoid;
  const existing = new Map(
    options.existingNodes.map((node) => [node.id, node]),
  );
  const idMap = new Map(fragment.nodes.map((node) => [node.id, makeId()]));
  const bounds = canvasNodeBounds(fragment.nodes);
  const offset = options.offset ?? {
    x: options.center.x - (bounds.left + bounds.right) / 2,
    y: options.center.y - (bounds.top + bounds.bottom) / 2,
  };
  const suffix = options.copySuffix ?? " Copy";

  const copiedNodes = fragment.nodes.map((source): CanvasNodeData => ({
    ...source,
    id: idMap.get(source.id)!,
    title:
      suffix && !source.title.endsWith(suffix)
        ? `${source.title}${suffix}`
        : source.title,
    position: {
      x: source.position.x + offset.x,
      y: source.position.y + offset.y,
    },
    metadata: clonedMetadata(
      source,
      idMap,
      existing,
      options.preserveExternalGroups === true,
    ),
  }));

  const seen = new Set<string>();
  const copiedConnections: CanvasConnection[] = [];
  for (const connection of fragment.connections) {
    const fromNodeId =
      idMap.get(connection.fromNodeId) ??
      (existing.has(connection.fromNodeId) ? connection.fromNodeId : undefined);
    const toNodeId = idMap.get(connection.toNodeId);
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) continue;
    const pair = `${fromNodeId}\u0000${toNodeId}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    copiedConnections.push({
      ...connection,
      id: makeId(),
      fromNodeId,
      toNodeId,
    });
  }
  return { nodes: copiedNodes, connections: copiedConnections };
}

function canvasNodeBounds(nodes: readonly CanvasNodeData[]) {
  if (!nodes.length) return { left: 0, top: 0, right: 0, bottom: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.position.x);
    top = Math.min(top, node.position.y);
    right = Math.max(right, node.position.x + node.width);
    bottom = Math.max(bottom, node.position.y + node.height);
  }
  return { left, top, right, bottom };
}

type Rect = { x: number; y: number; width: number; height: number };
type LayoutUnit = {
  id: string;
  nodes: CanvasNodeData[];
  nodeIds: string[];
  bounds: Rect;
};
const COLUMN_GAP = 140;
const ROW_GAP = 64;

function rectOf(nodes: readonly CanvasNodeData[]): Rect {
  const bounds = canvasNodeBounds(nodes);
  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  };
}

function orderedIds(ids: Iterable<string>) {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function groupComponents(nodes: readonly CanvasNodeData[]) {
  const parent = new Map(nodes.map((node) => [node.id, node.id]));
  const rootOf = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(id) !== id) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const join = (left: string, right: string) => {
    const a = rootOf(left);
    const b = rootOf(right);
    if (a === b) return;
    const [winner, loser] = orderedIds([a, b]);
    parent.set(loser, winner);
  };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const group = node.metadata?.groupId
      ? byId.get(node.metadata.groupId)
      : undefined;
    if (group?.type === CanvasNodeType.Group) join(group.id, node.id);
  }
  const components = new Map<string, CanvasNodeData[]>();
  for (const node of nodes) {
    const root = rootOf(node.id);
    components.set(root, [...(components.get(root) ?? []), node]);
  }
  return components;
}

function cycleMembership(nodes: readonly CanvasNodeData[]) {
  const groups = nodes.filter((node) => node.type === CanvasNodeType.Group);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    const parent = node.metadata?.groupId;
    if (parent && byId.get(parent)?.type === CanvasNodeType.Group) {
      children.set(parent, [...(children.get(parent) ?? []), node.id]);
    }
  }
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles = new Set<string>();
  const visit = (id: string) => {
    const status = state.get(id) ?? 0;
    if (status === 2) return;
    if (status === 1) {
      const start = stack.lastIndexOf(id);
      for (const cycleId of stack.slice(Math.max(0, start)))
        cycles.add(cycleId);
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const child of children.get(id) ?? []) {
      if (byId.get(child)?.type === CanvasNodeType.Group) visit(child);
    }
    stack.pop();
    state.set(id, 2);
  };
  groups.forEach((group) => visit(group.id));
  return { byId, children, cycles };
}

function refreshGroupFrames(nodes: readonly CanvasNodeData[]) {
  const { byId, children, cycles } = cycleMembership(nodes);
  const complete = new Map<string, CanvasNodeData>();
  const resolve = (id: string): CanvasNodeData => {
    const cached = complete.get(id);
    if (cached) return cached;
    const node = byId.get(id)!;
    if (node.type !== CanvasNodeType.Group || cycles.has(id)) {
      complete.set(id, node);
      return node;
    }
    const members = children.get(id) ?? [];
    if (!members.length) return node;
    const frame = canvasGroupFrame(members.map(resolve));
    const refreshed = {
      ...node,
      position: { x: frame.x, y: frame.y },
      width: frame.width,
      height: frame.height,
    };
    complete.set(id, refreshed);
    return refreshed;
  };
  for (const node of nodes) resolve(node.id);
  return complete;
}

function graphRanks(
  units: readonly LayoutUnit[],
  connections: readonly CanvasConnection[],
  unitOf: ReadonlyMap<string, string>,
) {
  const ids = orderedIds(units.map((unit) => unit.id));
  const included = new Set(ids);
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const edge of connections) {
    const from = unitOf.get(edge.fromNodeId);
    const to = unitOf.get(edge.toNodeId);
    if (from && to && from !== to && included.has(from) && included.has(to))
      adjacency.get(from)!.add(to);
  }

  let sequence = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const componentOf = new Map<string, number>();
  let componentCount = 0;
  const connect = (id: string) => {
    index.set(id, sequence);
    low.set(id, sequence);
    sequence += 1;
    stack.push(id);
    onStack.add(id);
    for (const target of orderedIds(adjacency.get(id)!)) {
      if (!index.has(target)) {
        connect(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, index.get(target)!));
      }
    }
    if (low.get(id) !== index.get(id)) return;
    while (stack.length) {
      const member = stack.pop()!;
      onStack.delete(member);
      componentOf.set(member, componentCount);
      if (member === id) break;
    }
    componentCount += 1;
  };
  ids.forEach((id) => {
    if (!index.has(id)) connect(id);
  });

  const outgoing = new Map<number, Set<number>>();
  const incoming = new Map<number, number>();
  const rank = new Map<number, number>();
  for (const component of componentOf.values()) {
    outgoing.set(component, new Set());
    incoming.set(component, 0);
    rank.set(component, 0);
  }
  for (const [fromId, targets] of adjacency) {
    const from = componentOf.get(fromId)!;
    for (const targetId of targets) {
      const to = componentOf.get(targetId)!;
      if (from === to || outgoing.get(from)!.has(to)) continue;
      outgoing.get(from)!.add(to);
      incoming.set(to, incoming.get(to)! + 1);
    }
  }
  const ready = [...incoming]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort((a, b) => a - b);
  while (ready.length) {
    const from = ready.shift()!;
    for (const to of [...outgoing.get(from)!].sort((a, b) => a - b)) {
      rank.set(to, Math.max(rank.get(to)!, rank.get(from)! + 1));
      incoming.set(to, incoming.get(to)! - 1);
      if (incoming.get(to) === 0) {
        ready.push(to);
        ready.sort((a, b) => a - b);
      }
    }
  }
  return new Map(ids.map((id) => [id, rank.get(componentOf.get(id)!)!]));
}

function verticalClearanceOffset(
  moving: readonly Rect[],
  fixed: readonly Rect[],
) {
  const forbidden: Array<{ from: number; to: number }> = [];
  for (const source of moving) {
    for (const obstacle of fixed) {
      const overlapX =
        source.x < obstacle.x + obstacle.width + ROW_GAP &&
        obstacle.x < source.x + source.width + ROW_GAP;
      if (!overlapX) continue;
      forbidden.push({
        from: obstacle.y - source.y - source.height - ROW_GAP,
        to: obstacle.y + obstacle.height + ROW_GAP - source.y,
      });
    }
  }
  forbidden.sort((a, b) => a.from - b.from || a.to - b.to);
  let shift = 0;
  for (const range of forbidden) {
    if (shift > range.from && shift < range.to) shift = range.to;
  }
  return shift;
}

/** Lays out connected groups as single units, breaking graph cycles into shared columns. */
export function tidyAtlasNodes(
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
  selectedIds: ReadonlySet<string> = new Set(),
): CanvasNodeData[] {
  if (!nodes.length) return nodes;
  const components = groupComponents(nodes);
  const refreshed = refreshGroupFrames(nodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const unitOf = new Map<string, string>();
  const units: LayoutUnit[] = [];
  for (const [id, members] of components) {
    const memberIds = members.map((node) => node.id);
    memberIds.forEach((memberId) => unitOf.set(memberId, id));
    const move =
      selectedIds.size === 0 ||
      memberIds.some((memberId) => selectedIds.has(memberId));
    const layoutNodes = move
      ? members.map((node) => refreshed.get(node.id) ?? node)
      : members;
    units.push({
      id,
      nodeIds: memberIds,
      nodes: layoutNodes,
      bounds: rectOf(layoutNodes),
    });
  }

  const moving = units.filter(
    (unit) =>
      selectedIds.size === 0 || unit.nodeIds.some((id) => selectedIds.has(id)),
  );
  if (!moving.length) return nodes;
  const ranks = graphRanks(moving, connections, unitOf);
  const columns = new Map<number, LayoutUnit[]>();
  for (const unit of moving)
    columns.set(ranks.get(unit.id)!, [
      ...(columns.get(ranks.get(unit.id)!) ?? []),
      unit,
    ]);
  for (const column of columns.values())
    column.sort((a, b) => a.id.localeCompare(b.id));

  const origin = moving.reduce(
    (point, unit) => ({
      x: Math.min(point.x, unit.bounds.x),
      y: Math.min(point.y, unit.bounds.y),
    }),
    { x: Infinity, y: Infinity },
  );
  let x = origin.x;
  const destinations = new Map<string, Rect>();
  const placed: Rect[] = [];
  for (const [, column] of [...columns].sort(([a], [b]) => a - b)) {
    let y = origin.y;
    for (const unit of column) {
      const destination = { ...unit.bounds, x, y };
      destinations.set(unit.id, destination);
      placed.push(destination);
      y += unit.bounds.height + ROW_GAP;
    }
    x += Math.max(...column.map((unit) => unit.bounds.width)) + COLUMN_GAP;
  }
  const stationary = units
    .filter((unit) => !destinations.has(unit.id))
    .map((unit) => unit.bounds);
  const verticalShift = verticalClearanceOffset(placed, stationary);
  const edits = new Map<string, CanvasNodeData>();
  for (const unit of moving) {
    const target = destinations.get(unit.id)!;
    const dx = target.x - unit.bounds.x;
    const dy = target.y + verticalShift - unit.bounds.y;
    for (const layoutNode of unit.nodes) {
      const original = nodeById.get(layoutNode.id)!;
      const position = {
        x: layoutNode.position.x + dx,
        y: layoutNode.position.y + dy,
      };
      if (
        position.x !== original.position.x ||
        position.y !== original.position.y ||
        layoutNode.width !== original.width ||
        layoutNode.height !== original.height
      ) {
        edits.set(original.id, { ...layoutNode, position });
      }
    }
  }
  return edits.size ? nodes.map((node) => edits.get(node.id) ?? node) : nodes;
}
