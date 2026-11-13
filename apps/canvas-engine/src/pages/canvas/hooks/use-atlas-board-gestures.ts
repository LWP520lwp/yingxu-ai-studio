import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import {
  cancelBoardNodeDrag,
  finishBoardNodeDrag,
  finishCanvasSelection,
  idleBoardInteraction,
  updateBoardNodeDrag,
  updateCanvasSelection,
  type BoardInteractionState,
} from "@/atlas-engine/interaction/canvas-board-adapter";
import { atlasInteractionOwnsPointer } from "@/atlas-engine/interaction/board-interactions";
import { getAtlasNodeDefinition } from "@/atlas-engine/model/node-registry";
import { CanvasNodeType, type CanvasNodeData, type ConnectionHandle, type Position, type SelectionBox, type ViewportTransform } from "@/types/canvas";
import type { PendingConnectionCreate } from "@/components/canvas/canvas-create-menus";
import type { ConnectionDropTarget } from "@/atlas-engine/interaction/connections";

type GesturePorts = {
  nodesRef: MutableRefObject<CanvasNodeData[]>;
  selectedNodeIdsRef: MutableRefObject<Set<string>>;
  viewportRef: MutableRefObject<ViewportTransform>;
  boardRef: MutableRefObject<BoardInteractionState>;
  historyPausedRef: MutableRefObject<boolean>;
  nodeDraggingRef: MutableRefObject<boolean>;
  selectionGestureRef: MutableRefObject<number>;
  previewFrameRef: MutableRefObject<number | null>;
  connectingRef: MutableRefObject<ConnectionHandle | null>;
  connectionTargetRef: MutableRefObject<string | null>;
  pendingConnectionRef: MutableRefObject<PendingConnectionCreate | null>;
  screenToCanvas: (clientX: number, clientY: number) => Position;
  getConnectionDropTarget: (clientX: number, clientY: number, handle: ConnectionHandle) => ConnectionDropTarget;
  connectNodes: (handle: ConnectionHandle, targetNodeId: string) => void;
  focusNode: (nodeId: string) => void;
  autoFocusOnSelect: () => boolean;
  setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectionBox: Dispatch<SetStateAction<SelectionBox | null>>;
  setIsNodeDragging: Dispatch<SetStateAction<boolean>>;
  setDropTargetGroupId: Dispatch<SetStateAction<string | null>>;
  setDialogNodeId: Dispatch<SetStateAction<string | null>>;
  setConnecting: (handle: ConnectionHandle | null) => void;
  setMouseWorld: Dispatch<SetStateAction<Position>>;
  setConnectionTargetNodeId: Dispatch<SetStateAction<string | null>>;
  setPendingConnectionCreate: Dispatch<SetStateAction<PendingConnectionCreate | null>>;
};

function stopScheduledPreview(frameRef: MutableRefObject<number | null>) {
  if (frameRef.current === null) return;
  cancelAnimationFrame(frameRef.current);
  frameRef.current = null;
}

export function useAtlasBoardGestures(ports: GesturePorts) {
  const portsRef = useRef(ports);
  portsRef.current = ports;

  const finishGesture = useCallback((clientX: number, clientY: number, pointerId: number) => {
    const currentPorts = portsRef.current;
    const current = currentPorts.boardRef.current;
    if (!atlasInteractionOwnsPointer(current, pointerId)) return;
    stopScheduledPreview(currentPorts.previewFrameRef);
    const world = currentPorts.screenToCanvas(clientX, clientY);

    if (current.mode === "marquee") {
      const result = finishCanvasSelection(current, current.pointerId, world, currentPorts.nodesRef.current);
      currentPorts.boardRef.current = result.state;
      currentPorts.setSelectionBox(null);
      if (result.selection) {
        currentPorts.selectedNodeIdsRef.current = result.selection;
        currentPorts.setSelectedNodeIds(result.selection);
      }
      return;
    }

    if (current.mode !== "node-drag") return;
    const result = finishBoardNodeDrag(
      current,
      currentPorts.nodesRef.current,
      { x: clientX, y: clientY },
      currentPorts.viewportRef.current.k,
    );
    currentPorts.boardRef.current = result.state;
    if (result.moved) {
      currentPorts.nodesRef.current = result.nodes;
      currentPorts.setNodes(result.nodes);
    }

    currentPorts.historyPausedRef.current = false;
    currentPorts.nodeDraggingRef.current = false;
    currentPorts.setIsNodeDragging(false);
    currentPorts.setDropTargetGroupId(null);

    const clickedId = result.clickedNodeId;
    if (!clickedId) return;
    const clicked = currentPorts.nodesRef.current.find((node) => node.id === clickedId);
    const definition = clicked ? getAtlasNodeDefinition(clicked.type) : undefined;
    if (definition?.hidePanel) {
      currentPorts.setDialogNodeId((active) => active === clickedId ? active : null);
      return;
    }
    if (!clicked || clicked.type === CanvasNodeType.Group) return;

    currentPorts.setDialogNodeId(clickedId);
    if (!currentPorts.autoFocusOnSelect()) return;
    const gestureAtClick = currentPorts.selectionGestureRef.current;
    requestAnimationFrame(() => {
      const selected = currentPorts.selectedNodeIdsRef.current;
      if (
        currentPorts.selectionGestureRef.current === gestureAtClick &&
        !currentPorts.nodeDraggingRef.current &&
        selected.size === 1 &&
        selected.has(clickedId)
      ) currentPorts.focusNode(clickedId);
    });
  }, []);

  const cancelGesture = useCallback(() => {
    const currentPorts = portsRef.current;
    stopScheduledPreview(currentPorts.previewFrameRef);
    const current = currentPorts.boardRef.current;
    if (current.mode === "node-drag") {
      const result = cancelBoardNodeDrag(current, currentPorts.nodesRef.current);
      currentPorts.boardRef.current = result.state;
      currentPorts.nodesRef.current = result.nodes;
      currentPorts.setNodes(result.nodes);
      currentPorts.historyPausedRef.current = false;
      currentPorts.nodeDraggingRef.current = false;
      currentPorts.setIsNodeDragging(false);
      currentPorts.setDropTargetGroupId(null);
    } else if (current.mode === "marquee") {
      currentPorts.boardRef.current = idleBoardInteraction();
      currentPorts.setSelectionBox(null);
    }
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const currentPorts = portsRef.current;
    const current = currentPorts.boardRef.current;
    const client = { x: event.clientX, y: event.clientY };

    if (current.mode === "marquee") {
      const update = updateCanvasSelection(
        current,
        event.pointerId,
        event.buttons,
        currentPorts.screenToCanvas(event.clientX, event.clientY),
        currentPorts.nodesRef.current,
      );
      currentPorts.boardRef.current = update.state;
      currentPorts.setSelectionBox(update.box);
      if (update.selection) {
        currentPorts.selectedNodeIdsRef.current = update.selection;
        currentPorts.setSelectedNodeIds(update.selection);
      }
      return;
    }

    if (current.mode === "node-drag") {
      const update = updateBoardNodeDrag(current, client, currentPorts.viewportRef.current.k, currentPorts.nodesRef.current);
      currentPorts.boardRef.current = update.state;
      if (update.state.mode !== "node-drag" || !update.state.hasMoved) {
        currentPorts.setDropTargetGroupId(null);
        return;
      }

      stopScheduledPreview(currentPorts.previewFrameRef);
      const gestureId = update.state.gestureId;
      currentPorts.previewFrameRef.current = requestAnimationFrame(() => {
        const latest = currentPorts.boardRef.current;
        if (latest.mode !== "node-drag" || latest.gestureId !== gestureId) {
          currentPorts.previewFrameRef.current = null;
          return;
        }
        const preview = updateBoardNodeDrag(latest, latest.current, currentPorts.viewportRef.current.k, currentPorts.nodesRef.current);
        currentPorts.boardRef.current = preview.state;
        currentPorts.nodesRef.current = preview.nodes;
        currentPorts.setNodes(preview.nodes);
        currentPorts.setDropTargetGroupId(preview.dropTargetId);
        currentPorts.previewFrameRef.current = null;
      });
      return;
    }

    const handle = currentPorts.connectingRef.current;
    if (!handle || currentPorts.pendingConnectionRef.current) return;
    const target = currentPorts.getConnectionDropTarget(event.clientX, event.clientY, handle);
    currentPorts.connectionTargetRef.current = target.nodeId;
    currentPorts.setConnectionTargetNodeId(target.nodeId);
    currentPorts.setMouseWorld(currentPorts.screenToCanvas(event.clientX, event.clientY));
  }, []);

  const handlePointerUp = useCallback((event: PointerEvent) => {
    const currentPorts = portsRef.current;
    if (!atlasInteractionOwnsPointer(currentPorts.boardRef.current, event.pointerId)) return;
    finishGesture(event.clientX, event.clientY, event.pointerId);
    if (currentPorts.pendingConnectionRef.current) return;

    const handle = currentPorts.connectingRef.current;
    if (!handle) return;
    const target = currentPorts.getConnectionDropTarget(event.clientX, event.clientY, handle);
    if (target.nodeId) {
      currentPorts.connectNodes(handle, target.nodeId);
      currentPorts.setConnecting(null);
    } else if (target.isNearNode) {
      currentPorts.setConnecting(null);
    } else {
      const position = currentPorts.screenToCanvas(event.clientX, event.clientY);
      currentPorts.setMouseWorld(position);
      currentPorts.setPendingConnectionCreate({ connection: handle, position });
    }
  }, [finishGesture]);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", cancelGesture);
    window.addEventListener("blur", cancelGesture);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", cancelGesture);
      window.removeEventListener("blur", cancelGesture);
    };
  }, [cancelGesture, handlePointerMove, handlePointerUp]);

  return { finishGesture, cancelGesture };
}
