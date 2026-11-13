import {
  useCallback,
  useRef,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  beginCanvasSelection,
  beginBoardNodeDrag,
  selectBoardNode,
  type BoardInteractionState,
} from "@/atlas-engine/interaction/canvas-board-adapter";
import type {
  CanvasNodeData,
  ContextMenuState,
  Position,
  SelectionBox,
} from "@/types/canvas";

type SelectionMouseEvent = Pick<MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">;

type AtlasNodeSelectionOptions = {
  nodesRef: MutableRefObject<CanvasNodeData[]>;
  selectedNodeIdsRef: MutableRefObject<Set<string>>;
  boardInteractionRef: MutableRefObject<BoardInteractionState>;
  gestureSequenceRef: MutableRefObject<number>;
  historyPausedRef: MutableRefObject<boolean>;
  nodeDraggingRef: MutableRefObject<boolean>;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setToolbarNodeId: Dispatch<SetStateAction<string | null>>;
  setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
  setSelectionBox: Dispatch<SetStateAction<SelectionBox | null>>;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
  setIsNodeDragging: Dispatch<SetStateAction<boolean>>;
};

export function useAtlasNodeSelection(options: AtlasNodeSelectionOptions) {
  const {
    boardInteractionRef,
    gestureSequenceRef,
    historyPausedRef,
    nodeDraggingRef,
    nodesRef,
    selectedNodeIdsRef,
    setContextMenu,
    setHoveredNodeId,
    setIsNodeDragging,
    setSelectedConnectionId,
    setSelectedNodeIds,
    setSelectionBox,
    setToolbarNodeId,
  } = options;
  const pendingSelectionRef = useRef<Set<string> | null>(null);
  const selectionGestureRef = useRef(0);

  const beginMarqueeSelection = useCallback(
    (world: Position, additive: boolean, pointerId: number) => {
      const started = beginCanvasSelection(
        world,
        selectedNodeIdsRef.current,
        additive,
        pointerId,
      );
      boardInteractionRef.current = started.state;
      selectedNodeIdsRef.current = started.selection;
      setSelectedNodeIds(started.selection);
      setSelectionBox(started.box);
      setSelectedConnectionId(null);
    },
    [
      boardInteractionRef,
      selectedNodeIdsRef,
      setSelectedConnectionId,
      setSelectedNodeIds,
      setSelectionBox,
    ],
  );

  const selectNodeByEvent = useCallback(
    (event: SelectionMouseEvent, nodeId: string) => {
      const nextSelected = selectBoardNode(
        selectedNodeIdsRef.current,
        nodeId,
        event.shiftKey || event.metaKey || event.ctrlKey,
      );
      selectedNodeIdsRef.current = nextSelected;
      setSelectedNodeIds(nextSelected);
      const soloId =
        nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null;
      setToolbarNodeId(soloId);
      return { nextSelected, soloId };
    },
    [selectedNodeIdsRef, setSelectedNodeIds, setToolbarNodeId],
  );

  const handleNodeSelectCapture = useCallback(
    (event: MouseEvent, nodeId: string) => {
      if (event.button !== 0) return;
      selectionGestureRef.current += 1;
      setContextMenu(null);
      setHoveredNodeId(null);
      setSelectedConnectionId(null);
      pendingSelectionRef.current = selectNodeByEvent(
        event,
        nodeId,
      ).nextSelected;
    },
    [
      selectNodeByEvent,
      setContextMenu,
      setHoveredNodeId,
      setSelectedConnectionId,
    ],
  );

  const handleNodeMouseDown = useCallback(
    (event: MouseEvent, nodeId: string) => {
      event.stopPropagation();
      const nextSelected =
        pendingSelectionRef.current ??
        selectNodeByEvent(event, nodeId).nextSelected;
      pendingSelectionRef.current = null;
      boardInteractionRef.current = beginBoardNodeDrag(
        nodesRef.current,
        nextSelected,
        nodeId,
        { x: event.clientX, y: event.clientY },
        ++gestureSequenceRef.current,
      );
      historyPausedRef.current = true;
      nodeDraggingRef.current = true;
      setIsNodeDragging(true);
    },
    [
      boardInteractionRef,
      gestureSequenceRef,
      historyPausedRef,
      nodeDraggingRef,
      nodesRef,
      selectNodeByEvent,
      setIsNodeDragging,
    ],
  );

  return {
    beginMarqueeSelection,
    handleNodeMouseDown,
    handleNodeSelectCapture,
    selectNodeByEvent,
    selectionGestureRef,
  };
}
