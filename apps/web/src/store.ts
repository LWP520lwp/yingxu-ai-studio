import { create } from "zustand";
import type {
  CanvasConnection,
  CanvasDocument,
  CanvasEdge,
  CanvasPoint,
  CanvasViewport,
  CreativeData,
  CreativeKind,
  CreativeNode,
} from "./types";

type ListChange<T> =
  | { type: "add"; item: T; index?: number }
  | { type: "replace"; id: string; item: T }
  | { type: "remove"; id: string }
  | { type: "select"; id: string; selected: boolean };
type NodeChange = ListChange<CreativeNode>
  | { type: "position"; id: string; position?: CanvasPoint; positionAbsolute?: CanvasPoint; dragging?: boolean }
  | { type: "dimensions"; id: string; dimensions?: { width: number; height: number }; resizing?: boolean; setAttributes?: boolean | "width" | "height" };
type EdgeChange = ListChange<CanvasEdge>;

/** Data-only compatibility for old schema-1 callers; the live canvas owns its own editor. */
function applyListChange<T extends { id: string; selected?: boolean }>(items: T[], change: ListChange<T>): T[] {
  if (change.type === "add") {
    const next = [...items];
    next.splice(change.index ?? next.length, 0, { ...change.item });
    return next;
  }
  if (change.type === "remove") return items.filter((item) => item.id !== change.id);
  return items.map((item) => item.id !== change.id ? item
    : change.type === "replace" ? { ...change.item } : { ...item, selected: change.selected });
}
function applyNodeChanges(changes: NodeChange[], nodes: CreativeNode[]) {
  return changes.reduce((items, change) => {
    if (change.type !== "position" && change.type !== "dimensions") return applyListChange(items, change);
    return items.map((item) => {
      if (item.id !== change.id) return item;
      if (change.type === "position") return { ...item,
        ...(change.position ? { position: { ...change.position } } : {}),
        ...(change.dragging === undefined ? {} : { dragging: change.dragging }),
      };
      return { ...item,
        ...(change.resizing === undefined ? {} : { resizing: change.resizing }),
        ...(change.dimensions ? { measured: { ...change.dimensions },
          ...(change.setAttributes === true || change.setAttributes === "width" ? { width: change.dimensions.width } : {}),
          ...(change.setAttributes === true || change.setAttributes === "height" ? { height: change.dimensions.height } : {}),
        } : {}),
      };
    });
  }, nodes);
}
const applyEdgeChanges = (changes: EdgeChange[], edges: CanvasEdge[]) => changes.reduce(applyListChange, edges);

const HISTORY_LIMIT = 100;
function dependencyGraph(document: CanvasDocument) {
  const graph = new Map(document.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of document.edges) graph.get(edge.source)?.add(edge.target);
  for (const node of document.nodes)
    for (const source of node.data.sourceNodeIds || []) graph.get(source)?.add(node.id);
  return graph;
}
function hasDependencyCycle(document: CanvasDocument) {
  const graph = dependencyGraph(document);
  const incoming = new Map([...graph.keys()].map((id) => [id, 0]));
  for (const targets of graph.values())
    for (const target of targets) incoming.set(target, (incoming.get(target) || 0) + 1);
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length) {
    const id = ready.pop()!;
    visited++;
    for (const target of graph.get(id) || []) {
      const remaining = incoming.get(target)! - 1;
      incoming.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }
  return visited !== graph.size;
}
function validEdges(document: CanvasDocument) {
  const ids = new Set(document.nodes.map((node) => node.id));
  const edgeIds = new Set<string>();
  const pairs = new Map<string, Set<string>>();
  for (const edge of document.edges) {
    if (!edge || typeof edge.id !== "string" || !edge.id || edgeIds.has(edge.id) ||
      !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target ||
      pairs.get(edge.source)?.has(edge.target)) return false;
    edgeIds.add(edge.id);
    if (!pairs.has(edge.source)) pairs.set(edge.source, new Set());
    pairs.get(edge.source)!.add(edge.target);
  }
  return !hasDependencyCycle(document);
}
const clean = (document: CanvasDocument): CanvasDocument => ({
  schemaVersion: 1,
  nodes: document.nodes.map(
    ({ selected: _selected, dragging: _dragging, measured: _measured, ...node }) => node,
  ),
  edges: document.edges,
  viewport: document.viewport,
});
export const emptyDocument = (): CanvasDocument => ({ schemaVersion: 1, nodes: [], edges: [] });
export function displaySize(node: CreativeNode) {
  if (node.data.kind !== "note" && !node.data.url &&
    !Number.isFinite(node.data.displayWidth) && !Number.isFinite(node.data.displayHeight))
    return { width: 360, height: 260 };
  const fallbackWidth = node.data.kind === "note" ? 260 : 300;
  const width = Number.isFinite(node.data.displayWidth)
    ? Math.max(80, Math.min(2400, node.data.displayWidth!)) : fallbackWidth;
  const ratio = node.data.kind === "note" ? 0.72
    : (node.data.height || (node.data.kind === "video" ? 720 : 1024)) /
      (node.data.width || (node.data.kind === "video" ? 1280 : 1024));
  const height = Number.isFinite(node.data.displayHeight)
    ? Math.max(60, Math.min(2400, node.data.displayHeight!))
    : Math.max(100, Math.min(900, width * ratio));
  return { width, height };
}
export const readDocument = (value: unknown): CanvasDocument => {
  const data = value as Partial<CanvasDocument> | null;
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.edges))
    throw new Error("画布文件格式不正确");
  if (data.nodes.length > 1500 || data.edges.length > 6000)
    throw new Error("画布超出当前项目大小限制");
  const ids = new Set<string>();
  for (const node of data.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || node.id.length > 128 || ids.has(node.id) ||
      node.type !== "creative" || !node.data ||
      typeof node.data.prompt !== "string" || typeof node.data.title !== "string" ||
      node.data.prompt.length > 6000 || node.data.title.length > 100 ||
      !["image", "video", "note"].includes(node.data.kind) ||
      !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y))
      throw new Error("画布包含无效节点");
    ids.add(node.id);
    if (node.data.url && (typeof node.data.url !== "string" ||
      !/^\/api\/assets\/[a-zA-Z0-9-]+\/content$/.test(node.data.url)))
      throw new Error("导入画布只能引用本平台素材");
    for (const key of ["displayWidth", "displayHeight"] as const) {
      const size = node.data[key];
      if (size !== undefined && (!Number.isFinite(size) || size < 40 || size > 4096))
        throw new Error("画布素材显示尺寸不正确");
    }
    for (const key of ["referenceAssetIds", "sourceNodeIds"] as const) {
      const references = node.data[key];
      if (references !== undefined && (!Array.isArray(references) || references.length > 1500 ||
        references.some((id) => typeof id !== "string" || !id || id.length > 128)))
        throw new Error("画布素材引用不正确");
    }
  }
  for (const node of data.nodes)
    if (node.data.sourceNodeIds?.some((id) => !ids.has(id) || id === node.id))
      throw new Error("画布包含无效引用");
  if (!validEdges(data as CanvasDocument)) throw new Error("画布包含无效或循环引用");
  if (data.viewport && (!Number.isFinite(data.viewport.x) || !Number.isFinite(data.viewport.y) ||
    !Number.isFinite(data.viewport.zoom) || data.viewport.zoom < 0.1 || data.viewport.zoom > 4))
    throw new Error("画布视口不正确");
  return clean(data as CanvasDocument);
};

type Gesture = { before: CanvasDocument };
type State = {
  document: CanvasDocument;
  editVersion: number;
  savedVersion: number;
  history: CanvasDocument[];
  future: CanvasDocument[];
  loadSerial: number;
  gesture: Gesture | null;
  load: (document: CanvasDocument) => void;
  changes: (changes: NodeChange[]) => void;
  edgeChanges: (changes: EdgeChange[]) => void;
  connect: (connection: CanvasConnection) => boolean;
  add: (kind: CreativeKind, data?: Partial<CreativeData>, position?: CanvasPoint) => string;
  patch: (id: string, data: Partial<CreativeData>) => void;
  select: (ids: string[], additive?: boolean) => void;
  beginGesture: () => void;
  moveSelected: (dx: number, dy: number) => void;
  previewPositions: (positions: Record<string, CanvasPoint>) => void;
  previewSize: (id: string, width: number, height: number) => void;
  endGesture: () => void;
  cancelGesture: () => void;
  setViewport: (viewport: CanvasViewport) => void;
  setInsertionPoint: (point: CanvasPoint) => void;
  remove: (id: string) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: (version: number) => void;
};
let lastTextEdit: { id: string; fields: string; time: number } | null = null;
let insertionPoint: CanvasPoint = { x: 80, y: 80 };
const historyWith = (history: CanvasDocument[], document: CanvasDocument) =>
  [...history.slice(-(HISTORY_LIMIT - 1)), clean(document)];
function next(state: State, document: CanvasDocument) {
  lastTextEdit = null;
  return { document, editVersion: state.editVersion + 1,
    history: historyWith(state.history, state.document), future: [], gesture: null };
}
function withCurrentView(document: CanvasDocument, state: State): CanvasDocument {
  const selected = new Set(state.document.nodes.filter((node) => node.selected).map((node) => node.id));
  return { ...document, viewport: state.document.viewport,
    nodes: document.nodes.map((node) => ({ ...node, selected: selected.has(node.id) })) };
}
function removeNodes(state: State, ids: Set<string>) {
  if (!state.document.nodes.some((node) => ids.has(node.id))) return state;
  return next(state, { ...state.document,
    nodes: state.document.nodes.filter((node) => !ids.has(node.id)).map((node) =>
      node.data.sourceNodeIds?.some((id) => ids.has(id))
        ? { ...node, data: { ...node.data, sourceNodeIds: node.data.sourceNodeIds.filter((id) => !ids.has(id)) } } : node),
    edges: state.document.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
  });
}
type CanvasMemoryState = Pick<State,
  "document" | "editVersion" | "savedVersion" | "history" | "future" | "loadSerial">;
type CanvasHotState = { version: 1; state: CanvasMemoryState };
/** Hot replacement must retain data, never actions that close over the old store. */
export function captureCanvasHotState(state: State): CanvasHotState {
  // Cancel an unfinished drag; its preview has not yet become an undoable edit.
  const document = state.gesture ? withCurrentView(state.gesture.before, state) : state.document;
  const snapshot: CanvasHotState = { version: 1, state: {
    document: { ...document, nodes: document.nodes.map(({ dragging: _dragging, measured: _measured, ...node }) => node) },
    editVersion: state.editVersion, savedVersion: state.savedVersion,
    history: state.history, future: state.future, loadSerial: state.loadSerial,
  } };
  return JSON.parse(JSON.stringify(snapshot)) as CanvasHotState;
}
export function restoreCanvasHotState(value: unknown): CanvasMemoryState | undefined {
  if (value === undefined) return undefined;
  const snapshot = value as Partial<CanvasHotState> | null;
  const state = snapshot?.state;
  const isDocument = (document: CanvasDocument | undefined) => document?.schemaVersion === 1 &&
    Array.isArray(document.nodes) && Array.isArray(document.edges);
  if (snapshot?.version !== 1 || !state || !isDocument(state.document) ||
    !Array.isArray(state.history) || !state.history.every(isDocument) ||
    !Array.isArray(state.future) || !state.future.every(isDocument) ||
    ![state.editVersion, state.savedVersion, state.loadSerial].every((count) => Number.isSafeInteger(count) && count >= 0))
    throw new Error("画布热更新状态损坏，请重新加载项目后继续编辑");
  return {
    document: state.document, editVersion: state.editVersion, savedVersion: state.savedVersion,
    history: state.history, future: state.future,
    // Reset Stage's transient pointers, connection preview and local viewport.
    loadSerial: state.loadSerial + 1,
  };
}
const restoredHotState = restoreCanvasHotState(import.meta.hot?.data.canvasState);
export const useCanvas = create<State>((set, get) => ({
  document: emptyDocument(), editVersion: 0, savedVersion: 0, history: [], future: [], gesture: null, loadSerial: 0,
  ...restoredHotState,
  load: (document) => {
    lastTextEdit = null;
    insertionPoint = { x: 80, y: 80 };
    set((state) => ({ document: clean(document), editVersion: 0, savedVersion: 0, history: [], future: [], gesture: null, loadSerial: state.loadSerial + 1 }));
  },
  // Legacy adapters keep existing documents and callers compatible during migration.
  changes: (changes) => set((state) => {
    const removed = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id));
    const remaining = removed.size ? removeNodes(state, removed).document : state.document;
    const document = { ...remaining, nodes: applyNodeChanges(changes, remaining.nodes) };
    return changes.some((change) => change.type !== "select" && change.type !== "dimensions")
      ? next(state, document) : { document };
  }),
  edgeChanges: (changes) => set((state) => {
    const edges = applyEdgeChanges(changes, state.document.edges);
    const removed = state.document.edges.filter((edge) => !edges.some((item) => item.source === edge.source && item.target === edge.target));
    const nodes = removed.length ? state.document.nodes.map((node) => {
      const sources = new Set(removed.filter((edge) => edge.target === node.id).map((edge) => edge.source));
      return node.data.sourceNodeIds?.some((id) => sources.has(id))
        ? { ...node, data: { ...node.data, sourceNodeIds: node.data.sourceNodeIds.filter((id) => !sources.has(id)) } } : node;
    }) : state.document.nodes;
    const document = { ...state.document, nodes, edges };
    if (!validEdges(document) || JSON.stringify(state.document.edges) === JSON.stringify(edges)) return state;
    return changes.every((change) => change.type === "select") ? { document } : next(state, document);
  }),
  connect: (connection) => {
    let accepted = false;
    set((state) => {
      if (!connection.source || !connection.target || state.document.edges.length >= 6000) return state;
      const document = { ...state.document, edges: [...state.document.edges,
        { ...connection, id: crypto.randomUUID(), type: "smoothstep" }] };
      if (!validEdges(document)) return state;
      accepted = true;
      return next(state, document);
    });
    return accepted;
  },
  add: (kind, data = {}, position) => {
    const id = crypto.randomUUID();
    set((state) => next(state, { ...state.document,
      nodes: [...state.document.nodes.map((node) => ({ ...node, selected: false })), {
        id, type: "creative", selected: true,
        position: position ? { ...position } : { ...insertionPoint },
        data: { kind, title: kind === "image" ? "图像创作" : kind === "video" ? "视频创作" : "灵感笔记",
          prompt: "", width: kind === "video" ? 1280 : 1024, height: kind === "video" ? 720 : 1024,
          duration: 5, ...data },
      }],
    }));
    if (!position) insertionPoint = { x: insertionPoint.x + 32, y: insertionPoint.y + 32 };
    return id;
  },
  patch: (id, data) => set((state) => {
    const node = state.document.nodes.find((item) => item.id === id);
    if (!node || Object.entries(data).every(([key, value]) => Object.is(node.data[key], value))) return state;
    const document = { ...state.document, nodes: state.document.nodes.map((item) =>
      item.id === id ? { ...item, data: { ...item.data, ...data } } : item) };
    if (state.gesture) return { document };
    const fields = Object.keys(data).sort().join(",");
    const textOnly = Object.keys(data).every((key) => key === "title" || key === "prompt");
    const now = Date.now();
    const merge = textOnly && lastTextEdit?.id === id && lastTextEdit.fields === fields && now - lastTextEdit.time < 1000;
    const update = merge ? { document, editVersion: state.editVersion + 1, future: [] } : next(state, document);
    lastTextEdit = textOnly ? { id, fields, time: now } : null;
    return update;
  }),
  select: (ids, additive = false) => set((state) => {
    lastTextEdit = null;
    const chosen = new Set(ids);
    return { document: { ...state.document, nodes: state.document.nodes.map((node) =>
      ({ ...node, selected: chosen.has(node.id) || (additive && !!node.selected) })) } };
  }),
  beginGesture: () => set((state) => {
    lastTextEdit = null;
    return state.gesture ? state : { gesture: { before: clean(state.document) } };
  }),
  moveSelected: (dx, dy) => set((state) => {
    if (!state.gesture || !Number.isFinite(dx) || !Number.isFinite(dy)) return state;
    const starts = new Map(state.gesture.before.nodes.map((node) => [node.id, node.position]));
    return { document: { ...state.document, nodes: state.document.nodes.map((node) => {
      const start = starts.get(node.id);
      return node.selected && start ? { ...node, position: { x: start.x + dx, y: start.y + dy } } : node;
    }) } };
  }),
  previewPositions: (positions) => set((state) => state.gesture ? { document: { ...state.document,
    nodes: state.document.nodes.map((node) => {
      const point = positions[node.id];
      return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { ...node, position: { ...point } } : node;
    }) } } : state),
  previewSize: (id, width, height) => {
    if (Number.isFinite(width) && Number.isFinite(height)) get().patch(id, {
      displayWidth: Math.max(80, Math.min(2400, width)), displayHeight: Math.max(60, Math.min(2400, height)),
    });
  },
  endGesture: () => set((state) => {
    if (!state.gesture) return state;
    const before = state.gesture.before;
    const after = clean(state.document);
    const changed = JSON.stringify([before.nodes, before.edges]) !== JSON.stringify([after.nodes, after.edges]);
    return changed ? { gesture: null, editVersion: state.editVersion + 1,
      history: historyWith(state.history, before), future: [] } : { gesture: null };
  }),
  cancelGesture: () => set((state) => state.gesture
    ? { document: withCurrentView(state.gesture.before, state), gesture: null } : state),
  setViewport: (viewport) => set((state) => {
    if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite)) return state;
    const nextView = { ...viewport, zoom: Math.max(0.1, Math.min(4, viewport.zoom)) };
    const previous = state.document.viewport;
    if (previous && previous.x === nextView.x && previous.y === nextView.y && previous.zoom === nextView.zoom) return state;
    return { document: { ...state.document, viewport: nextView }, editVersion: state.editVersion + 1 };
  }),
  setInsertionPoint: (point) => { if (Number.isFinite(point.x) && Number.isFinite(point.y)) insertionPoint = { ...point }; },
  remove: (id) => set((state) => removeNodes(state, new Set([id]))),
  deleteSelected: () => set((state) => removeNodes(state,
    new Set(state.document.nodes.filter((node) => node.selected).map((node) => node.id)))),
  duplicateSelected: () => set((state) => {
    const selected = state.document.nodes.filter((node) => node.selected);
    if (!selected.length) return state;
    const ids = new Map(selected.map((node) => [node.id, crypto.randomUUID()]));
    const duplicates = selected.map((node) => ({ ...node, id: ids.get(node.id)!, selected: true,
      position: { x: node.position.x + 32, y: node.position.y + 32 }, data: { ...node.data,
        ...(node.data.sourceNodeIds ? { sourceNodeIds: node.data.sourceNodeIds.map((id) => ids.get(id) || id) } : {}),
        ...(node.data.referenceAssetIds ? { referenceAssetIds: [...node.data.referenceAssetIds] } : {}),
      } }));
    return next(state, { ...state.document,
      nodes: [...state.document.nodes.map((node) => ({ ...node, selected: false })), ...duplicates],
      edges: [...state.document.edges, ...state.document.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
        .map((edge) => ({ ...edge, id: crypto.randomUUID(), source: ids.get(edge.source)!, target: ids.get(edge.target)! }))],
    });
  }),
  undo: () => set((state) => {
    lastTextEdit = null;
    if (state.gesture) return { document: withCurrentView(state.gesture.before, state), gesture: null };
    return state.history.length ? { document: withCurrentView(state.history.at(-1)!, state),
      history: state.history.slice(0, -1), future: [clean(state.document), ...state.future],
      editVersion: state.editVersion + 1 } : state;
  }),
  redo: () => set((state) => {
    lastTextEdit = null;
    return !state.gesture && state.future.length ? { document: withCurrentView(state.future[0], state),
      history: historyWith(state.history, state.document), future: state.future.slice(1),
      editVersion: state.editVersion + 1 } : state;
  }),
  markSaved: (version) => set({ savedVersion: version }),
}));
if (import.meta.hot) import.meta.hot.dispose((data) => {
  data.canvasState = captureCanvasHotState(useCanvas.getState());
});
export const serializeDocument = () => clean(useCanvas.getState().document);
