export type AtlasBoardPoint = Readonly<{ x: number; y: number }>;

export type AtlasBoardNode = Readonly<{
  id: string;
  kind: string;
  position: AtlasBoardPoint;
  width: number;
  height: number;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type AtlasSelectionBox = Readonly<{
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  additive: boolean;
  initialSelectedNodeIds: readonly string[];
}>;

export type AtlasBoardInteractionState =
  | { mode: "idle" }
  | { mode: "marquee"; pointerId: number; box: AtlasSelectionBox }
  | {
      mode: "node-drag";
      gestureId: number;
      start: AtlasBoardPoint;
      current: AtlasBoardPoint;
      initialPositions: ReadonlyMap<string, AtlasBoardPoint>;
      movedIds: ReadonlySet<string>;
      clickNodeId: string | null;
      hasMoved: boolean;
    };

export function atlasInteractionOwnsPointer(
  state: AtlasBoardInteractionState,
  pointerId: number,
) {
  return state.mode !== "marquee" || state.pointerId === pointerId;
}

export const ATLAS_DRAG_THRESHOLD = 3;
const GROUP_KIND = "group";
const GROUP_CONTENT_INSET = 24;

export const idleAtlasBoardInteraction = (): AtlasBoardInteractionState => ({
  mode: "idle",
});

export function beginAtlasSelection(
  world: AtlasBoardPoint,
  selectedIds: ReadonlySet<string>,
  additive: boolean,
  pointerId: number,
) {
  const box: AtlasSelectionBox = {
    startWorldX: world.x,
    startWorldY: world.y,
    currentWorldX: world.x,
    currentWorldY: world.y,
    additive,
    initialSelectedNodeIds: additive ? [...selectedIds] : [],
  };
  return {
    state: { mode: "marquee", pointerId, box } as AtlasBoardInteractionState,
    selection: new Set(box.initialSelectedNodeIds),
    box,
  };
}

export function selectAtlasNode(
  selectedIds: ReadonlySet<string>,
  nodeId: string,
  additive: boolean,
) {
  const next = new Set(selectedIds);
  if (additive) {
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
  } else if (!next.has(nodeId)) {
    next.clear();
    next.add(nodeId);
  }
  return next;
}

export function beginAtlasNodeDrag(
  nodes: readonly AtlasBoardNode[],
  selectedIds: ReadonlySet<string>,
  nodeId: string,
  client: AtlasBoardPoint,
  gestureId: number,
): AtlasBoardInteractionState {
  const movedIds = new Set(selectedIds);
  for (const node of nodes) {
    if (node.kind !== GROUP_KIND || !selectedIds.has(node.id)) continue;
    for (const child of nodes) {
      if (child.metadata?.groupId === node.id) movedIds.add(child.id);
    }
  }

  const initialPositions = new Map<string, AtlasBoardPoint>();
  for (const node of nodes) {
    if (!movedIds.has(node.id)) continue;
    initialPositions.set(node.id, { x: node.position.x, y: node.position.y });
  }

  return {
    mode: "node-drag",
    gestureId,
    start: { ...client },
    current: { ...client },
    initialPositions,
    movedIds: new Set(initialPositions.keys()),
    clickNodeId:
      selectedIds.size === 1 && selectedIds.has(nodeId) ? nodeId : null,
    hasMoved: false,
  };
}

export function updateAtlasSelection(
  state: AtlasBoardInteractionState,
  pointerId: number,
  buttons: number,
  world: AtlasBoardPoint,
  nodes: readonly AtlasBoardNode[],
) {
  if (state.mode !== "marquee" || state.pointerId !== pointerId) {
    return { state, box: state.mode === "marquee" ? state.box : null };
  }
  if (buttons === 0) return { state: idleAtlasBoardInteraction(), box: null };

  const box = { ...state.box, currentWorldX: world.x, currentWorldY: world.y };
  return {
    state: { ...state, box },
    box,
    selection: nodesIntersectingBox(box, nodes),
  };
}

export function finishAtlasSelection(
  state: AtlasBoardInteractionState,
  pointerId: number,
  world: AtlasBoardPoint,
  nodes: readonly AtlasBoardNode[],
) {
  if (state.mode !== "marquee" || state.pointerId !== pointerId) {
    return { state, box: state.mode === "marquee" ? state.box : null };
  }
  const box = { ...state.box, currentWorldX: world.x, currentWorldY: world.y };
  return {
    state: idleAtlasBoardInteraction(),
    box: null,
    selection: nodesIntersectingBox(box, nodes),
  };
}

export function updateAtlasNodeDrag(
  state: AtlasBoardInteractionState,
  client: AtlasBoardPoint,
  scale: number,
  nodes: readonly AtlasBoardNode[],
) {
  if (state.mode !== "node-drag") {
    return { state, nodes, dropTargetId: null as string | null };
  }

  const nextState: Extract<AtlasBoardInteractionState, { mode: "node-drag" }> = {
    ...state,
    current: { ...client },
    hasMoved:
      state.hasMoved ||
      Math.abs(client.x - state.start.x) > ATLAS_DRAG_THRESHOLD ||
      Math.abs(client.y - state.start.y) > ATLAS_DRAG_THRESHOLD,
  };
  if (!nextState.hasMoved) return { state: nextState, nodes, dropTargetId: null };

  const preview = positionDraggedNodes(nextState, nodes, scale);
  const target = findAtlasGroupDropTarget(nextState.movedIds, preview);
  return { state: nextState, nodes: preview, dropTargetId: target?.id ?? null };
}

export function finishAtlasNodeDrag(
  state: AtlasBoardInteractionState,
  nodes: readonly AtlasBoardNode[],
  client: AtlasBoardPoint,
  scale: number,
) {
  if (state.mode !== "node-drag") {
    return { state, nodes, moved: false, clickedNodeId: null as string | null };
  }
  const updated = updateAtlasNodeDrag(state, client, scale, nodes);
  const active = updated.state;
  if (active.mode !== "node-drag" || !active.hasMoved) {
    return {
      state: idleAtlasBoardInteraction(),
      nodes,
      moved: false,
      clickedNodeId: active.mode === "node-drag" ? active.clickNodeId : null,
    };
  }

  const positioned = positionDraggedNodes(active, nodes, scale);
  const target = findAtlasGroupDropTarget(active.movedIds, positioned);
  return {
    state: idleAtlasBoardInteraction(),
    nodes: target
      ? moveIntoAtlasGroup(active.movedIds, positioned, target)
      : assignContainingAtlasGroups(active.movedIds, positioned),
    moved: true,
    clickedNodeId: null,
  };
}

export function cancelAtlasNodeDrag(
  state: AtlasBoardInteractionState,
  nodes: readonly AtlasBoardNode[],
) {
  if (state.mode !== "node-drag") {
    return { state: idleAtlasBoardInteraction(), nodes };
  }
  return {
    state: idleAtlasBoardInteraction(),
    nodes: nodes.map((node) => {
      const initial = state.initialPositions.get(node.id);
      return initial
        ? { ...node, position: { x: initial.x, y: initial.y } }
        : node;
    }),
  };
}

function nodesIntersectingBox(
  box: AtlasSelectionBox,
  nodes: readonly AtlasBoardNode[],
) {
  const left = Math.min(box.startWorldX, box.currentWorldX);
  const right = Math.max(box.startWorldX, box.currentWorldX);
  const top = Math.min(box.startWorldY, box.currentWorldY);
  const bottom = Math.max(box.startWorldY, box.currentWorldY);
  const selected = new Set(box.initialSelectedNodeIds);
  for (const node of nodes) {
    const nodeLeft = finite(node.position.x);
    const nodeTop = finite(node.position.y);
    const nodeRight = nodeLeft + Math.max(0, finite(node.width));
    const nodeBottom = nodeTop + Math.max(0, finite(node.height));
    if (left < nodeRight && right > nodeLeft && top < nodeBottom && bottom > nodeTop) {
      selected.add(node.id);
    }
  }
  return selected;
}

function positionDraggedNodes(
  state: Extract<AtlasBoardInteractionState, { mode: "node-drag" }>,
  nodes: readonly AtlasBoardNode[],
  scale: number,
) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const dx = (state.current.x - state.start.x) / safeScale;
  const dy = (state.current.y - state.start.y) / safeScale;
  return nodes.map((node) => {
    const initial = state.initialPositions.get(node.id);
    if (!initial || (dx === 0 && dy === 0)) return node;
    return { ...node, position: { x: initial.x + dx, y: initial.y + dy } };
  });
}

export function findAtlasGroupDropTarget(
  movedIds: ReadonlySet<string>,
  nodes: readonly AtlasBoardNode[],
) {
  if (nodes.some((node) => movedIds.has(node.id) && node.kind === GROUP_KIND)) return null;
  const dragged = nodes.filter((node) => movedIds.has(node.id) && node.kind !== GROUP_KIND);
  if (dragged.length === 0) return null;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const candidate = nodes[index];
    if (
      candidate.kind === GROUP_KIND &&
      !movedIds.has(candidate.id) &&
      dragged.some((node) => containsCenter(candidate, node))
    ) {
      return candidate;
    }
  }
  return null;
}

function moveIntoAtlasGroup(
  movedIds: ReadonlySet<string>,
  nodes: readonly AtlasBoardNode[],
  group: AtlasBoardNode,
) {
  const dragged = nodes.filter((node) => movedIds.has(node.id) && node.kind !== GROUP_KIND);
  if (dragged.length === 0) return nodes;
  const bounds = boundsOf(dragged);
  const inset = GROUP_CONTENT_INSET;
  const left = finite(group.position.x) + inset;
  const right = finite(group.position.x) + Math.max(0, finite(group.width)) - inset;
  const top = finite(group.position.y) + inset;
  const bottom = finite(group.position.y) + Math.max(0, finite(group.height)) - inset;
  const dx = bounds.right - bounds.left > right - left
    ? left - bounds.left
    : bounds.left < left
      ? left - bounds.left
      : bounds.right > right
        ? right - bounds.right
        : 0;
  const dy = bounds.bottom - bounds.top > bottom - top
    ? top - bounds.top
    : bounds.top < top
      ? top - bounds.top
      : bounds.bottom > bottom
        ? bottom - bounds.bottom
        : 0;

  return nodes.map((node) => {
    if (!movedIds.has(node.id) || node.kind === GROUP_KIND) return node;
    const position = { x: finite(node.position.x) + dx, y: finite(node.position.y) + dy };
    if (node.metadata?.groupId === group.id && position.x === node.position.x && position.y === node.position.y) {
      return node;
    }
    return { ...node, position, metadata: { ...node.metadata, groupId: group.id } };
  });
}

function assignContainingAtlasGroups(
  movedIds: ReadonlySet<string>,
  nodes: readonly AtlasBoardNode[],
) {
  return nodes.map((node) => {
    if (!movedIds.has(node.id) || node.kind === GROUP_KIND) return node;
    const groupId = findContainingAtlasGroupId(node, nodes);
    if (node.metadata?.groupId === groupId) return node;
    return { ...node, metadata: { ...node.metadata, groupId } };
  });
}

export function findContainingAtlasGroupId(
  node: AtlasBoardNode,
  nodes: readonly AtlasBoardNode[],
) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const group = nodes[index];
    if (group.kind === GROUP_KIND && group.id !== node.id && containsCenter(group, node)) {
      return group.id;
    }
  }
  return undefined;
}

function containsCenter(container: AtlasBoardNode, candidate: AtlasBoardNode) {
  const x = finite(candidate.position.x) + Math.max(0, finite(candidate.width)) / 2;
  const y = finite(candidate.position.y) + Math.max(0, finite(candidate.height)) / 2;
  const left = finite(container.position.x);
  const top = finite(container.position.y);
  return x >= left && x <= left + Math.max(0, finite(container.width))
    && y >= top && y <= top + Math.max(0, finite(container.height));
}

function boundsOf(nodes: readonly AtlasBoardNode[]) {
  return nodes.reduce(
    (bounds, node) => ({
      left: Math.min(bounds.left, finite(node.position.x)),
      top: Math.min(bounds.top, finite(node.position.y)),
      right: Math.max(bounds.right, finite(node.position.x) + Math.max(0, finite(node.width))),
      bottom: Math.max(bounds.bottom, finite(node.position.y) + Math.max(0, finite(node.height))),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}
