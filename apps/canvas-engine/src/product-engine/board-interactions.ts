import {
  findContainingGroupId,
  findGroupDropTarget,
  snapNodesIntoGroup,
} from "@/lib/canvas/canvas-node-geometry";
import {
  CanvasNodeType,
  type CanvasNodeData,
  type SelectionBox,
} from "@/types/canvas";

export type BoardPoint = { x: number; y: number };
export type BoardNodePositions = ReadonlyMap<string, BoardPoint>;

export type BoardInteractionState =
  | { mode: "idle" }
  | { mode: "marquee"; pointerId: number; box: SelectionBox }
  | {
      mode: "node-drag";
      gestureId: number;
      start: BoardPoint;
      current: BoardPoint;
      initialPositions: BoardNodePositions;
      movedIds: ReadonlySet<string>;
      clickNodeId: string | null;
      hasMoved: boolean;
    };

export const idleBoardInteraction = (): BoardInteractionState => ({
  mode: "idle",
});

export function beginCanvasSelection(
  world: BoardPoint,
  selectedIds: ReadonlySet<string>,
  additive: boolean,
  pointerId: number,
) {
  const box: SelectionBox = {
    startWorldX: world.x,
    startWorldY: world.y,
    currentWorldX: world.x,
    currentWorldY: world.y,
    additive,
    initialSelectedNodeIds: additive ? [...selectedIds] : [],
  };

  return {
    state: { mode: "marquee", pointerId, box } as BoardInteractionState,
    selection: new Set(box.initialSelectedNodeIds),
    box,
  };
}

export function selectBoardNode(
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

export function beginBoardNodeDrag(
  nodes: readonly CanvasNodeData[],
  selectedIds: ReadonlySet<string>,
  nodeId: string,
  client: BoardPoint,
  gestureId: number,
): BoardInteractionState {
  const movedIds = new Set(selectedIds);
  const selectedGroups = nodes.filter(
    (node) => node.type === CanvasNodeType.Group && selectedIds.has(node.id),
  );

  for (const group of selectedGroups) {
    for (const node of nodes) {
      if (node.metadata?.groupId === group.id) movedIds.add(node.id);
    }
  }

  const initialPositions = new Map<string, BoardPoint>();
  for (const node of nodes) {
    if (movedIds.has(node.id)) {
      initialPositions.set(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
    }
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

export function updateCanvasSelection(
  state: BoardInteractionState,
  pointerId: number,
  buttons: number,
  world: BoardPoint,
  nodes: readonly CanvasNodeData[],
) {
  if (state.mode !== "marquee" || pointerId !== state.pointerId) {
    return { state, box: state.mode === "marquee" ? state.box : null };
  }
  if (buttons === 0) {
    return { state: idleBoardInteraction(), box: null };
  }

  const box = {
    ...state.box,
    currentWorldX: world.x,
    currentWorldY: world.y,
  };
  return {
    state: { ...state, box },
    box,
    selection: nodesIntersectingSelection(box, nodes),
  };
}

export function finishCanvasSelection(
  state: BoardInteractionState,
  pointerId: number,
  world: BoardPoint,
  nodes: readonly CanvasNodeData[],
) {
  if (state.mode !== "marquee" || state.pointerId !== pointerId) {
    return { state, box: state.mode === "marquee" ? state.box : null };
  }

  const box = { ...state.box, currentWorldX: world.x, currentWorldY: world.y };
  return {
    state: idleBoardInteraction(),
    box: null,
    selection: nodesIntersectingSelection(box, nodes),
  };
}

export function updateBoardNodeDrag(
  state: BoardInteractionState,
  client: BoardPoint,
  scale: number,
  nodes: readonly CanvasNodeData[],
) {
  if (state.mode !== "node-drag") {
    return { state, nodes: nodes as CanvasNodeData[], dropTargetId: null };
  }

  const nextState = {
    ...state,
    current: { ...client },
    hasMoved:
      state.hasMoved ||
      Math.abs(client.x - state.start.x) > DRAG_THRESHOLD ||
      Math.abs(client.y - state.start.y) > DRAG_THRESHOLD,
  };

  if (!nextState.hasMoved) {
    return { state: nextState, nodes: nodes as CanvasNodeData[], dropTargetId: null };
  }

  const preview = positionNodes(nextState, nodes, scale);
  const dropTarget = findGroupDropTarget(nextState.movedIds, preview);
  return { state: nextState, nodes: preview, dropTargetId: dropTarget?.id ?? null };
}

export function finishBoardNodeDrag(
  state: BoardInteractionState,
  nodes: readonly CanvasNodeData[],
  client: BoardPoint,
  scale: number,
) {
  if (state.mode !== "node-drag") {
    return {
      state,
      nodes: nodes as CanvasNodeData[],
      moved: false,
      clickedNodeId: null,
    };
  }

  const updated = updateBoardNodeDrag(state, client, scale, nodes);
  const active = updated.state;
  if (active.mode !== "node-drag" || !active.hasMoved) {
    return {
      state: idleBoardInteraction(),
      nodes: nodes as CanvasNodeData[],
      moved: false,
      clickedNodeId: active.mode === "node-drag" ? active.clickNodeId : null,
    };
  }

  const placed = positionNodes(active, nodes, scale);
  const destination = findGroupDropTarget(active.movedIds, placed);
  const committed = destination
    ? snapNodesIntoGroup(active.movedIds, placed, destination)
    : assignContainingGroups(active.movedIds, placed);

  return {
    state: idleBoardInteraction(),
    nodes: committed,
    moved: true,
    clickedNodeId: null,
  };
}

export function cancelBoardNodeDrag(
  state: BoardInteractionState,
  nodes: readonly CanvasNodeData[],
) {
  if (state.mode !== "node-drag") {
    return { state: idleBoardInteraction(), nodes: nodes as CanvasNodeData[] };
  }

  return {
    state: idleBoardInteraction(),
    nodes: nodes.map((node) => {
      const start = state.initialPositions.get(node.id);
      return start
        ? { ...node, position: { x: start.x, y: start.y } }
        : node;
    }),
  };
}

const DRAG_THRESHOLD = 3;

function nodesIntersectingSelection(
  box: SelectionBox,
  nodes: readonly CanvasNodeData[],
) {
  const left = Math.min(box.startWorldX, box.currentWorldX);
  const right = Math.max(box.startWorldX, box.currentWorldX);
  const top = Math.min(box.startWorldY, box.currentWorldY);
  const bottom = Math.max(box.startWorldY, box.currentWorldY);
  const selected = new Set(box.initialSelectedNodeIds);

  for (const node of nodes) {
    const nodeRight = node.position.x + node.width;
    const nodeBottom = node.position.y + node.height;
    if (
      left < nodeRight &&
      right > node.position.x &&
      top < nodeBottom &&
      bottom > node.position.y
    ) {
      selected.add(node.id);
    }
  }

  return selected;
}

function positionNodes(
  state: Extract<BoardInteractionState, { mode: "node-drag" }>,
  nodes: readonly CanvasNodeData[],
  scale: number,
) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const dx = (state.current.x - state.start.x) / safeScale;
  const dy = (state.current.y - state.start.y) / safeScale;

  return nodes.map((node) => {
    const start = state.initialPositions.get(node.id);
    if (!start || (dx === 0 && dy === 0)) return node;
    return { ...node, position: { x: start.x + dx, y: start.y + dy } };
  });
}

function assignContainingGroups(
  movedIds: ReadonlySet<string>,
  nodes: CanvasNodeData[],
) {
  return nodes.map((node) => {
    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) {
      return node;
    }

    const groupId = findContainingGroupId(node, nodes);
    if (node.metadata?.groupId === groupId) return node;
    return { ...node, metadata: { ...node.metadata, groupId } };
  });
}
