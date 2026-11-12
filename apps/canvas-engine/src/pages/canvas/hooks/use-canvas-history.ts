import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type {
  CanvasAssistantSession,
  CanvasConnection,
  CanvasNodeData,
  ContextMenuState,
} from "@/types/canvas";
import {
  commitDocument,
  createDocumentHistory,
  redoDocument,
  undoDocument,
  type DocumentHistory,
} from "@/product-engine/history";
import { fromStoredCanvas, toStoredCanvas } from "@/product-engine/compat";
import type { ProductDocument } from "@/product-engine/document";

export type CanvasHistoryEntry = {
  base: CanvasProject;
  document: ProductDocument;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  chatSessions: CanvasAssistantSession[];
  activeChatId: string | null;
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
};

type HistoryPayload = Omit<CanvasHistoryEntry, "base" | "document">;

export function createCanvasHistoryEntry(
  base: CanvasProject,
  payload: HistoryPayload,
): CanvasHistoryEntry {
  const project = { ...base, ...payload };
  return {
    ...payload,
    base,
    document: fromStoredCanvas(project),
  };
}

export function canvasHistoryProjectPatch(
  entry: CanvasHistoryEntry,
): HistoryPayload {
  const {
    nodes,
    connections,
    chatSessions,
    activeChatId,
    backgroundMode,
    showImageInfo,
  } = entry;
  return {
    nodes,
    connections,
    chatSessions,
    activeChatId,
    backgroundMode,
    showImageInfo,
  };
}

type HistoryArgs = {
  project: CanvasProject | null;
  projectLoaded: boolean;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  chatSessions: CanvasAssistantSession[];
  activeChatId: string | null;
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
  setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
  setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
  setChatSessions: Dispatch<SetStateAction<CanvasAssistantSession[]>>;
  setActiveChatId: Dispatch<SetStateAction<string | null>>;
  setBackgroundMode: Dispatch<SetStateAction<CanvasBackgroundMode>>;
  setShowImageInfo: Dispatch<SetStateAction<boolean>>;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

const sameSnapshot = (
  left: CanvasHistoryEntry | null,
  right: CanvasHistoryEntry,
) =>
  Boolean(
    left &&
    left.nodes === right.nodes &&
    left.connections === right.connections &&
    left.chatSessions === right.chatSessions &&
    left.activeChatId === right.activeChatId &&
    left.backgroundMode === right.backgroundMode &&
    left.showImageInfo === right.showImageInfo,
  );

export function useCanvasHistory(args: HistoryArgs) {
  const projectBase = useMemo(
    () =>
      args.project
        ? {
            ...args.project,
            nodes: [],
            connections: [],
            chatSessions: [],
          }
        : null,
    [args.project?.createdAt, args.project?.id, args.project?.title],
  );
  const stacksRef = useRef<{
    past: CanvasHistoryEntry[];
    future: CanvasHistoryEntry[];
  }>({ past: [], future: [] });
  const engineRef = useRef<DocumentHistory<CanvasHistoryEntry> | null>(null);
  const currentRef = useRef<CanvasHistoryEntry | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingRef = useRef(false);
  const pausedRef = useRef(false);
  const [state, setState] = useState({ canUndo: false, canRedo: false });

  const snapshot = useCallback((): CanvasHistoryEntry => {
    if (!projectBase) throw new Error("画布项目尚未载入");
    return createCanvasHistoryEntry(projectBase, {
      nodes: args.nodes,
      connections: args.connections,
      chatSessions: args.chatSessions,
      activeChatId: args.activeChatId,
      backgroundMode: args.backgroundMode,
      showImageInfo: args.showImageInfo,
    });
  }, [
    args.activeChatId,
    args.backgroundMode,
    args.chatSessions,
    args.connections,
    args.nodes,
    args.showImageInfo,
    projectBase,
  ]);

  const reset = useCallback((entry: CanvasHistoryEntry) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    commitTimerRef.current = null;
    applyTimerRef.current = null;
    applyingRef.current = false;
    engineRef.current = createDocumentHistory(entry);
    stacksRef.current = { past: [], future: [] };
    currentRef.current = entry;
    setState({ canUndo: false, canRedo: false });
  }, []);

  const apply = useCallback(
    (entry: CanvasHistoryEntry) => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
      commitTimerRef.current = null;
      applyingRef.current = true;
      const project = toStoredCanvas(entry.base, entry.document);
      args.setNodes(project.nodes);
      args.setConnections(project.connections);
      args.setChatSessions(project.chatSessions);
      args.setActiveChatId(project.activeChatId);
      args.setBackgroundMode(project.backgroundMode);
      args.setShowImageInfo(project.showImageInfo);
      args.setSelectedNodeIds(new Set());
      args.setSelectedConnectionId(null);
      args.setContextMenu(null);
      applyTimerRef.current = setTimeout(() => {
        applyTimerRef.current = null;
        currentRef.current = entry;
        applyingRef.current = false;
        setState({
          canUndo: stacksRef.current.past.length > 0,
          canRedo: stacksRef.current.future.length > 0,
        });
      }, 0);
    },
    [
      args.setActiveChatId,
      args.setBackgroundMode,
      args.setChatSessions,
      args.setConnections,
      args.setContextMenu,
      args.setNodes,
      args.setSelectedConnectionId,
      args.setSelectedNodeIds,
      args.setShowImageInfo,
    ],
  );

  const undo = useCallback(() => {
    const current = engineRef.current;
    if (!current) return;
    const next = undoDocument(current);
    if (next === current) return;
    engineRef.current = next;
    stacksRef.current = { past: next.past, future: next.future };
    apply(next.present);
  }, [apply]);

  const redo = useCallback(() => {
    const current = engineRef.current;
    if (!current) return;
    const next = redoDocument(current);
    if (next === current) return;
    engineRef.current = next;
    stacksRef.current = { past: next.past, future: next.future };
    apply(next.present);
  }, [apply]);

  useEffect(() => {
    if (!args.projectLoaded || applyingRef.current || pausedRef.current) return;
    const next = snapshot();
    if (!currentRef.current) {
      currentRef.current = next;
      return;
    }
    if (sameSnapshot(currentRef.current, next)) return;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      const previous = currentRef.current;
      if (!previous) return;
      const history = engineRef.current;
      if (!history) return;
      const nextHistory = commitDocument(history, snapshot());
      engineRef.current = nextHistory;
      stacksRef.current = {
        past: nextHistory.past,
        future: nextHistory.future,
      };
      currentRef.current = nextHistory.present;
      commitTimerRef.current = null;
      setState({
        canUndo: nextHistory.past.length > 0,
        canRedo: nextHistory.future.length > 0,
      });
    }, 180);
    return () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    };
  }, [args.projectLoaded, snapshot]);

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    },
    [],
  );

  return {
    stacksRef,
    currentRef,
    commitTimerRef,
    applyingRef,
    pausedRef,
    state,
    snapshot,
    reset,
    undo,
    redo,
  };
}
