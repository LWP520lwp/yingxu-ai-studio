import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import i18n from "@/i18n";
import { CanvasAgentSession } from "@/lib/agent-canvas-session";
import { useAgentStore } from "@/stores/use-agent-store";
import type { CanvasAgentSnapshot } from "@/atlas-engine/agent/canvas-operations";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type ReactValue<T> = Dispatch<SetStateAction<T>>;
type DocumentState = Pick<CanvasAgentSnapshot, "projectId" | "nodes" | "connections" | "viewport"> & {
  title: string | undefined;
  selectedNodeIds: Set<string>;
};
type LiveState = Pick<DocumentState, "nodes" | "connections" | "selectedNodeIds" | "viewport">;
type StateRefs = { [K in keyof LiveState as `${K}Ref`]: MutableRefObject<LiveState[K]> };
type StateWriters = { [K in keyof LiveState as `set${Capitalize<K>}`]: ReactValue<LiveState[K]> };
type BridgeInput = DocumentState & StateRefs & StateWriters & {
  generateNodeRef: MutableRefObject<((id: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;
  setSelectedConnectionId: ReactValue<string | null>;
  setContextMenu: ReactValue<ContextMenuState | null>;
};

function snapshot(input: BridgeInput): CanvasAgentSnapshot {
  return {
    projectId: input.projectId,
    title: input.title?.trim() || i18n.t("canvas.project.untitled"),
    nodes: input.nodesRef.current,
    connections: input.connectionsRef.current,
    selectedNodeIds: [...input.selectedNodeIdsRef.current],
    viewport: input.viewportRef.current,
  };
}

function commit(input: BridgeInput, value: CanvasAgentSnapshot) {
  const selection = new Set(value.selectedNodeIds);
  input.nodesRef.current = value.nodes;
  input.connectionsRef.current = value.connections;
  input.selectedNodeIdsRef.current = selection;
  input.viewportRef.current = value.viewport;
  input.setNodes(value.nodes);
  input.setConnections(value.connections);
  input.setSelectedNodeIds(selection);
  input.setViewport(value.viewport);
  input.setSelectedConnectionId(null);
  input.setContextMenu(null);
}

export function useAgentBridge(input: BridgeInput) {
  const latest = useRef(input);
  latest.current = input;
  const [undoOwner, setUndoOwner] = useState<CanvasAgentSession | null>(null);
  const session = useMemo(() => {
    const projectId = input.projectId;
    const owned = () => latest.current.projectId === projectId;
    const controller = new CanvasAgentSession({
      read: () => snapshot(latest.current),
      write: (value) => { if (owned()) commit(latest.current, value); },
      generate: ({ nodeId, mode, prompt }) => {
        if (owned()) void latest.current.generateNodeRef.current?.(nodeId, mode, prompt);
      },
      historyChanged: (canUndo) => { if (owned()) setUndoOwner(canUndo ? controller : null); },
    });
    return controller;
  }, [input.projectId]);
  const current = useRef(session);
  if (current.current !== session) {
    current.current.retire();
    current.current = session;
  }
  useEffect(() => {
    session.activate();
    return () => session.retire();
  }, [session]);

  const context = useMemo(() => ({
    snapshot: {
      projectId: input.projectId,
      title: input.title?.trim() || i18n.t("canvas.project.untitled"),
      nodes: input.nodes,
      connections: input.connections,
      selectedNodeIds: [...input.selectedNodeIds],
      viewport: input.viewport,
    },
    applyOps: session.apply.bind(session),
    undoOps: session.undo.bind(session),
    canUndo: undoOwner === session,
  }), [input.projectId, input.title, input.nodes, input.connections, input.selectedNodeIds, input.viewport, session, undoOwner]);
  useEffect(() => {
    useAgentStore.getState().setCanvasContext(context);
    return () => useAgentStore.getState().setCanvasContext(null);
  }, [context]);
  const applyAgentOps = useMemo(() => session.apply.bind(session), [session]);
  return { applyAgentOps };
}
