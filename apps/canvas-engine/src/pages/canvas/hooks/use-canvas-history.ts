import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { commitHistory, redoHistory, undoHistory, type HistoryStacks } from "@/lib/canvas/canvas-history-stack";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ContextMenuState } from "@/types/canvas";

export type CanvasHistoryEntry = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type HistoryArgs = {
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

const sameSnapshot = (left: CanvasHistoryEntry | null, right: CanvasHistoryEntry) => Boolean(
    left && left.nodes === right.nodes && left.connections === right.connections && left.chatSessions === right.chatSessions &&
    left.activeChatId === right.activeChatId && left.backgroundMode === right.backgroundMode && left.showImageInfo === right.showImageInfo,
);

export function useCanvasHistory(args: HistoryArgs) {
    const stacksRef = useRef<HistoryStacks<CanvasHistoryEntry>>({ past: [], future: [] });
    const currentRef = useRef<CanvasHistoryEntry | null>(null);
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingRef = useRef(false);
    const pausedRef = useRef(false);
    const [state, setState] = useState({ canUndo: false, canRedo: false });

    const snapshot = useCallback((): CanvasHistoryEntry => ({
        nodes: args.nodes,
        connections: args.connections,
        chatSessions: args.chatSessions,
        activeChatId: args.activeChatId,
        backgroundMode: args.backgroundMode,
        showImageInfo: args.showImageInfo,
    }), [args.activeChatId, args.backgroundMode, args.chatSessions, args.connections, args.nodes, args.showImageInfo]);

    const reset = useCallback((entry: CanvasHistoryEntry) => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
        commitTimerRef.current = null;
        applyTimerRef.current = null;
        applyingRef.current = false;
        stacksRef.current = { past: [], future: [] };
        currentRef.current = entry;
        setState({ canUndo: false, canRedo: false });
    }, []);

    const apply = useCallback((entry: CanvasHistoryEntry) => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
        commitTimerRef.current = null;
        applyingRef.current = true;
        args.setNodes(entry.nodes);
        args.setConnections(entry.connections);
        args.setChatSessions(entry.chatSessions);
        args.setActiveChatId(entry.activeChatId);
        args.setBackgroundMode(entry.backgroundMode);
        args.setShowImageInfo(entry.showImageInfo);
        args.setSelectedNodeIds(new Set());
        args.setSelectedConnectionId(null);
        args.setContextMenu(null);
        applyTimerRef.current = setTimeout(() => {
            applyTimerRef.current = null;
            currentRef.current = entry;
            applyingRef.current = false;
            setState({ canUndo: stacksRef.current.past.length > 0, canRedo: stacksRef.current.future.length > 0 });
        }, 0);
    }, [args.setActiveChatId, args.setBackgroundMode, args.setChatSessions, args.setConnections, args.setContextMenu, args.setNodes, args.setSelectedConnectionId, args.setSelectedNodeIds, args.setShowImageInfo]);

    const undo = useCallback(() => {
        const result = undoHistory(stacksRef.current, currentRef.current);
        if (!result) return;
        stacksRef.current = result.stacks;
        apply(result.entry);
    }, [apply]);

    const redo = useCallback(() => {
        const result = redoHistory(stacksRef.current, currentRef.current);
        if (!result) return;
        stacksRef.current = result.stacks;
        apply(result.entry);
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
            stacksRef.current = commitHistory(stacksRef.current, previous);
            currentRef.current = snapshot();
            commitTimerRef.current = null;
            setState({ canUndo: true, canRedo: false });
        }, 180);
        return () => {
            if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
            commitTimerRef.current = null;
        };
    }, [args.projectLoaded, snapshot]);

    useEffect(() => () => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    }, []);

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
