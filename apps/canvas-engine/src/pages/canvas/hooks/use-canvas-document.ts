import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import {
  hydrateAssistantImages,
  hydrateCanvasImages,
  resetInterruptedGeneration,
} from "@/lib/canvas/canvas-generation-helpers";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type {
  CanvasAssistantSession,
  CanvasConnection,
  CanvasNodeData,
  ViewportTransform,
} from "@/types/canvas";

import {
  canvasHistoryProjectPatch,
  createCanvasHistoryEntry,
  type CanvasHistoryEntry,
} from "./use-canvas-history";

type CanvasDocumentArgs = {
  projectId: string;
  projectLoaded: boolean;
  setLoadedProjectId: Dispatch<SetStateAction<string | null>>;
  retrySequence: number;
  setRetrySequence: Dispatch<SetStateAction<number>>;
  hydrated: boolean;
  openProject: (id: string) => CanvasProject | null;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  updateProject: (
    id: string,
    patch: Partial<
      Pick<
        CanvasProject,
        | "nodes"
        | "connections"
        | "chatSessions"
        | "activeChatId"
        | "backgroundMode"
        | "showImageInfo"
        | "viewport"
      >
    >,
  ) => void;
  history: {
    pausedRef: MutableRefObject<boolean>;
    reset: (entry: CanvasHistoryEntry) => void;
    snapshot: () => CanvasHistoryEntry;
  };
  viewportRef: MutableRefObject<ViewportTransform>;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  chatSessions: CanvasAssistantSession[];
  activeChatId: string | null;
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
  viewport: ViewportTransform;
  setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
  setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
  setChatSessions: Dispatch<SetStateAction<CanvasAssistantSession[]>>;
  setActiveChatId: Dispatch<SetStateAction<string | null>>;
  setBackgroundMode: Dispatch<SetStateAction<CanvasBackgroundMode>>;
  setShowImageInfo: Dispatch<SetStateAction<boolean>>;
  setViewport: Dispatch<SetStateAction<ViewportTransform>>;
  onRestoreError?: (error: unknown) => void;
};

export function useCanvasDocument(args: CanvasDocumentArgs) {
  const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const loadedProjectIdRef = useRef<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!args.hydrated) return;
    let active = true;
    loadedProjectIdRef.current = null;
    args.setLoadedProjectId(null);
    setRestoreError(null);
    const project = args.openProject(args.projectId);
    if (!project) {
      args.navigate("/canvas", { replace: true });
      return () => {
        active = false;
      };
    }

    const restore = async () => {
      try {
        const restoredNodes = await hydrateCanvasImages(
          resetInterruptedGeneration(project.nodes),
        );
        const restoredSessions = await hydrateAssistantImages(
          project.chatSessions || [],
        );
        if (!active) return;

        const entry = createCanvasHistoryEntry(project, {
          nodes: restoredNodes,
          connections: project.connections,
          chatSessions: restoredSessions,
          activeChatId: project.activeChatId || null,
          backgroundMode: project.backgroundMode,
          showImageInfo: project.showImageInfo || false,
        });
        args.setNodes(restoredNodes);
        args.setConnections(project.connections);
        args.setChatSessions(restoredSessions);
        args.setActiveChatId(entry.activeChatId);
        args.setBackgroundMode(entry.backgroundMode);
        args.setShowImageInfo(entry.showImageInfo);
        args.setViewport(project.viewport);
        args.history.reset(entry);
        loadedProjectIdRef.current = args.projectId;
        args.setLoadedProjectId(args.projectId);
      } catch (error) {
        if (active) {
          setRestoreError(
            error instanceof Error ? error.message : "画布恢复失败，请重试",
          );
          args.onRestoreError?.(error);
        }
      }
    };
    void restore();

    return () => {
      active = false;
    };
  }, [
    args.hydrated,
    args.history.reset,
    args.navigate,
    args.onRestoreError,
    args.openProject,
    args.projectId,
    args.retrySequence,
    args.setActiveChatId,
    args.setBackgroundMode,
    args.setChatSessions,
    args.setConnections,
    args.setLoadedProjectId,
    args.setNodes,
    args.setShowImageInfo,
    args.setViewport,
  ]);

  useEffect(() => {
    if (
      !args.projectLoaded ||
      loadedProjectIdRef.current !== args.projectId ||
      args.history.pausedRef.current
    )
      return;
    args.updateProject(args.projectId, {
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
    args.history.pausedRef,
    args.nodes,
    args.projectId,
    args.projectLoaded,
    args.showImageInfo,
    args.updateProject,
  ]);

  useEffect(() => {
    const capture = (event: Event) => {
      const detail = (
        event as CustomEvent<{ projectId: string; captured: boolean }>
      ).detail;
      if (
        !args.projectLoaded ||
        loadedProjectIdRef.current !== args.projectId ||
        !detail ||
        detail.projectId !== args.projectId
      )
        return;
      if (viewportSaveTimerRef.current) {
        clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = null;
      }
      args.updateProject(args.projectId, {
        ...canvasHistoryProjectPatch(args.history.snapshot()),
        viewport: { ...args.viewportRef.current },
      });
      detail.captured = true;
    };
    window.addEventListener("frameflow:capture-document", capture);
    return () =>
      window.removeEventListener("frameflow:capture-document", capture);
  }, [
    args.history.snapshot,
    args.projectId,
    args.projectLoaded,
    args.updateProject,
    args.viewportRef,
  ]);

  useEffect(() => {
    if (!args.projectLoaded || loadedProjectIdRef.current !== args.projectId)
      return;
    if (viewportSaveTimerRef.current)
      clearTimeout(viewportSaveTimerRef.current);
    viewportSaveTimerRef.current = setTimeout(() => {
      args.updateProject(args.projectId, {
        viewport: args.viewportRef.current,
      });
      viewportSaveTimerRef.current = null;
    }, 500);
    return () => {
      if (viewportSaveTimerRef.current)
        clearTimeout(viewportSaveTimerRef.current);
    };
  }, [
    args.projectId,
    args.projectLoaded,
    args.updateProject,
    args.viewport,
    args.viewportRef,
  ]);

  const retry = useCallback(
    () => args.setRetrySequence((sequence) => sequence + 1),
    [args.setRetrySequence],
  );
  return { restoreError, retry };
}
