import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type {
  CanvasConnection,
  CanvasNodeData,
  ViewportTransform,
} from "@/types/canvas";
import {
  reconcileAtlasCanvasNodes,
  replaceAtlasCanvasDocument,
  toCanvasConnections,
  toCanvasNodes,
  toCanvasViewport,
} from "@/atlas-engine/adapter";
import type { AtlasDocument, AtlasSelection } from "@/atlas-engine/model";
import { applyAtlasCommands, createEmptyAtlasDocument, reduceAtlasDocument } from "@/atlas-engine/reducer";
import type { AtlasCommand } from "@/atlas-engine/reducer";

type Updater<T> = SetStateAction<T>;

function resolveUpdate<T>(update: Updater<T>, current: T): T {
  return typeof update === "function"
    ? (update as (value: T) => T)(current)
    : update;
}

export function updateAtlasCanvasNodes(
  document: AtlasDocument,
  update: Updater<CanvasNodeData[]>,
): AtlasDocument {
  const nodes = resolveUpdate(update, toCanvasNodes(document));
  return reconcileAtlasCanvasNodes(document, nodes);
}

export function updateAtlasCanvasConnections(
  document: AtlasDocument,
  update: Updater<CanvasConnection[]>,
): AtlasDocument {
  const connections = resolveUpdate(update, toCanvasConnections(document));
  return replaceAtlasCanvasDocument(
    document,
    toCanvasNodes(document),
    connections,
    toCanvasViewport(document.viewport),
    document.selection,
  );
}

export function updateAtlasCanvasViewport(
  document: AtlasDocument,
  update: Updater<ViewportTransform>,
): AtlasDocument {
  const viewport = resolveUpdate(update, toCanvasViewport(document.viewport));
  return reduceAtlasDocument(document, {
    type: "set-viewport",
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.k },
  });
}

export function updateAtlasSelectedNodes(
  document: AtlasDocument,
  update: Updater<Set<string>>,
): AtlasDocument {
  const selected = resolveUpdate(update, new Set(document.selection.nodeIds));
  return reduceAtlasDocument(document, {
    type: "select",
    nodeIds: [...selected],
    edgeId: document.selection.edgeId,
  });
}

export function updateAtlasSelectedConnection(
  document: AtlasDocument,
  update: Updater<string | null>,
): AtlasDocument {
  const selected = resolveUpdate(update, document.selection.edgeId ?? null);
  return reduceAtlasDocument(document, {
    type: "select",
    nodeIds: document.selection.nodeIds,
    edgeId: selected ?? undefined,
  });
}

export type AtlasDocumentState = {
  document: AtlasDocument;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  viewport: ViewportTransform;
  selectedNodeIds: Set<string>;
  selectedConnectionId: string | null;
  dispatchAtlasCommands: (commands: readonly AtlasCommand[]) => void;
  setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
  setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
  setViewport: Dispatch<SetStateAction<ViewportTransform>>;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
  replaceCanvasState: (
    nodes: readonly CanvasNodeData[],
    connections: readonly CanvasConnection[],
    viewport: ViewportTransform,
    selection?: AtlasSelection,
  ) => void;
};

/** Atlas-owned document state with legacy-shaped projections for the current canvas UI. */
export function useAtlasDocumentState(): AtlasDocumentState {
  const [document, setDocument] = useState(createEmptyAtlasDocument);

  const nodes = useMemo(() => toCanvasNodes(document), [document.nodes]);
  const connections = useMemo(() => toCanvasConnections(document), [document.edges]);
  const viewport = useMemo(() => toCanvasViewport(document.viewport), [document.viewport]);
  const selectedNodeIds = useMemo(
    () => new Set(document.selection.nodeIds),
    [document.selection],
  );
  const selectedConnectionId = document.selection.edgeId ?? null;

  const dispatchAtlasCommands = useCallback(
    (commands: readonly AtlasCommand[]) => setDocument((current) => applyAtlasCommands(current, commands)),
    [],
  );

  const setNodes = useCallback<Dispatch<SetStateAction<CanvasNodeData[]>>>(
    (update) => setDocument((current) => updateAtlasCanvasNodes(current, update)),
    [],
  );
  const setConnections = useCallback<Dispatch<SetStateAction<CanvasConnection[]>>>(
    (update) => setDocument((current) => updateAtlasCanvasConnections(current, update)),
    [],
  );
  const setViewport = useCallback<Dispatch<SetStateAction<ViewportTransform>>>(
    (update) => setDocument((current) => updateAtlasCanvasViewport(current, update)),
    [],
  );
  const setSelectedNodeIds = useCallback<Dispatch<SetStateAction<Set<string>>>>(
    (update) => setDocument((current) => updateAtlasSelectedNodes(current, update)),
    [],
  );
  const setSelectedConnectionId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (update) => setDocument((current) => updateAtlasSelectedConnection(current, update)),
    [],
  );
  const replaceCanvasState = useCallback(
    (
      nextNodes: readonly CanvasNodeData[],
      nextConnections: readonly CanvasConnection[],
      nextViewport: ViewportTransform,
      selection?: AtlasSelection,
    ) => setDocument((current) => replaceAtlasCanvasDocument(
      current,
      nextNodes,
      nextConnections,
      nextViewport,
      selection ?? current.selection,
    )),
    [],
  );

  return {
    document,
    nodes,
    connections,
    viewport,
    selectedNodeIds,
    selectedConnectionId,
    dispatchAtlasCommands,
    setNodes,
    setConnections,
    setViewport,
    setSelectedNodeIds,
    setSelectedConnectionId,
    replaceCanvasState,
  };
}
