import type { CanvasNodeData, SelectionBox } from "@/types/canvas";
import {
  beginAtlasNodeDrag,
  beginAtlasSelection,
  cancelAtlasNodeDrag,
  finishAtlasNodeDrag,
  finishAtlasSelection,
  idleAtlasBoardInteraction,
  selectAtlasNode,
  updateAtlasNodeDrag,
  updateAtlasSelection,
  type AtlasBoardInteractionState,
  type AtlasBoardNode,
  type AtlasBoardPoint,
  type AtlasSelectionBox,
} from "./board-interactions";

export type BoardPoint = { x: number; y: number };
export type BoardNodePositions = ReadonlyMap<string, BoardPoint>;

type AtlasMarqueeState = Extract<AtlasBoardInteractionState, { mode: "marquee" }>;
type AtlasDragState = Extract<AtlasBoardInteractionState, { mode: "node-drag" }>;

export type BoardInteractionState =
  | { mode: "idle" }
  | { mode: "marquee"; pointerId: number; box: SelectionBox }
  | AtlasDragState;

export const idleBoardInteraction = (): BoardInteractionState => ({ mode: "idle" });

export function beginCanvasSelection(
  world: BoardPoint,
  selectedIds: ReadonlySet<string>,
  additive: boolean,
  pointerId: number,
) {
  const result = beginAtlasSelection(world, selectedIds, additive, pointerId);
  return {
    ...result,
    state: fromAtlasState(result.state),
    box: fromAtlasBox(result.box),
  };
}

export function selectBoardNode(
  selectedIds: ReadonlySet<string>,
  nodeId: string,
  additive: boolean,
) {
  return selectAtlasNode(selectedIds, nodeId, additive);
}

export function beginBoardNodeDrag(
  nodes: readonly CanvasNodeData[],
  selectedIds: ReadonlySet<string>,
  nodeId: string,
  client: BoardPoint,
  gestureId: number,
) {
  return fromAtlasState(
    beginAtlasNodeDrag(toAtlasNodes(nodes), selectedIds, nodeId, client, gestureId),
  );
}

export function updateCanvasSelection(
  state: BoardInteractionState,
  pointerId: number,
  buttons: number,
  world: BoardPoint,
  nodes: readonly CanvasNodeData[],
) {
  const atlasState = toAtlasState(state);
  const result = updateAtlasSelection(
    atlasState,
    pointerId,
    buttons,
    world,
    toAtlasNodes(nodes),
  );
  const atlasBox = atlasState.mode === "marquee" ? atlasState.box : null;
  return {
    ...result,
    state: result.state === atlasState ? state : fromAtlasState(result.state),
    box: result.box === atlasBox
      ? state.mode === "marquee" ? state.box : null
      : fromAtlasBox(result.box),
    ...(result.selection ? { selection: result.selection } : {}),
  };
}

export function finishCanvasSelection(
  state: BoardInteractionState,
  pointerId: number,
  world: BoardPoint,
  nodes: readonly CanvasNodeData[],
) {
  const atlasState = toAtlasState(state);
  const result = finishAtlasSelection(
    atlasState,
    pointerId,
    world,
    toAtlasNodes(nodes),
  );
  const atlasBox = atlasState.mode === "marquee" ? atlasState.box : null;
  return {
    ...result,
    state: result.state === atlasState ? state : fromAtlasState(result.state),
    box: result.box === atlasBox
      ? state.mode === "marquee" ? state.box : null
      : fromAtlasBox(result.box),
    ...(result.selection ? { selection: result.selection } : {}),
  };
}

export function updateBoardNodeDrag(
  state: BoardInteractionState,
  client: BoardPoint,
  scale: number,
  nodes: readonly CanvasNodeData[],
) {
  const result = updateAtlasNodeDrag(
    toAtlasState(state),
    client,
    scale,
    toAtlasNodes(nodes),
  );
  return {
    ...result,
    state: fromAtlasState(result.state),
    nodes: mergeAtlasNodes(nodes, result.nodes),
  };
}

export function finishBoardNodeDrag(
  state: BoardInteractionState,
  nodes: readonly CanvasNodeData[],
  client: BoardPoint,
  scale: number,
) {
  const result = finishAtlasNodeDrag(
    toAtlasState(state),
    toAtlasNodes(nodes),
    client,
    scale,
  );
  return {
    ...result,
    state: fromAtlasState(result.state),
    nodes: mergeAtlasNodes(nodes, result.nodes),
  };
}

export function cancelBoardNodeDrag(
  state: BoardInteractionState,
  nodes: readonly CanvasNodeData[],
) {
  const result = cancelAtlasNodeDrag(toAtlasState(state), toAtlasNodes(nodes));
  return {
    ...result,
    state: fromAtlasState(result.state),
    nodes: mergeAtlasNodes(nodes, result.nodes),
  };
}

function toAtlasState(state: BoardInteractionState): AtlasBoardInteractionState {
  if (state.mode === "marquee") {
    return {
      ...state,
      box: {
        ...state.box,
        initialSelectedNodeIds: [...state.box.initialSelectedNodeIds],
      },
    };
  }
  return state;
}

function fromAtlasState(state: AtlasBoardInteractionState): BoardInteractionState {
  if (state.mode === "marquee") {
    const box: SelectionBox = {
      ...state.box,
      initialSelectedNodeIds: [...state.box.initialSelectedNodeIds],
    };
    return { ...state, box };
  }
  return state;
}

function fromAtlasBox(box: AtlasSelectionBox | null): SelectionBox | null {
  if (!box) return null;
  return { ...box, initialSelectedNodeIds: [...box.initialSelectedNodeIds] };
}

function toAtlasNodes(nodes: readonly CanvasNodeData[]): AtlasBoardNode[] {
  return nodes.map((node) => ({
    id: node.id,
    kind: node.type,
    position: node.position,
    width: node.width,
    height: node.height,
    metadata: node.metadata,
  }));
}

function mergeAtlasNodes(
  originals: readonly CanvasNodeData[],
  updates: readonly AtlasBoardNode[],
): CanvasNodeData[] {
  const byId = new Map(updates.map((node) => [node.id, node]));
  let changed = false;
  const merged = originals.map((node) => {
    const update = byId.get(node.id);
    if (!update) return node;

    const positionChanged =
      update.position.x !== node.position.x || update.position.y !== node.position.y;
    const groupId = typeof update.metadata?.groupId === "string"
      ? update.metadata.groupId
      : undefined;
    const groupChanged = groupId !== node.metadata?.groupId;
    if (!positionChanged && !groupChanged) return node;

    const metadata = groupChanged
      ? { ...node.metadata, groupId }
      : node.metadata;
    changed = true;
    return {
      ...node,
      position: positionChanged ? { ...update.position } : node.position,
      ...(metadata ? { metadata } : {}),
    };
  });
  return changed ? merged : originals as CanvasNodeData[];
}
