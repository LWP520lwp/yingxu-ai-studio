import type {
  CanvasConnection,
  CanvasNodeData,
  CanvasNodeMetadata,
  ViewportTransform,
} from "@/types/canvas";

export type StudioDocument = {
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  viewport: ViewportTransform;
  backgroundMode: "dots" | "lines" | "none";
  showImageInfo: boolean;
};
export type StudioPort = {
  read(): StudioDocument;
  change(
    recipe: (document: StudioDocument) => StudioDocument,
    history?: boolean,
  ): void;
  insert(nodes: CanvasNodeData[], connections?: CanvasConnection[]): void;
  alive(): boolean;
  notice(message: string): void;
};
export type StudioSnapshot = {
  document: StudioDocument;
  selection: ReadonlySet<string>;
  edge: string | null;
  undo: boolean;
  redo: boolean;
  revision: number;
};
const finite = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);
export const STUDIO_ZOOM_LIMITS = { minScale: 0.12, maxScale: 3 } as const;
export const studioId = () => crypto.randomUUID();

export function makeStudioNode(
  type: string,
  x: number,
  y: number,
  title: string,
  metadata: CanvasNodeMetadata = {},
): CanvasNodeData {
  const width = type === "group" ? 640 : type === "text" ? 320 : 360;
  const height = type === "group" ? 440 : type === "text" ? 210 : 250;
  return {
    id: studioId(),
    type,
    title,
    position: { x, y },
    width,
    height,
    metadata: { status: "idle", ...metadata },
  };
}

/** The document boundary accepts geometry and graph data; UI selections never enter draft history. */
export function normalizeStudioDocument(input: StudioDocument): StudioDocument {
  const ids = new Set<string>();
  const validNodes = input.nodes.filter(
    (node) => node.id && !ids.has(node.id) && Boolean(ids.add(node.id)),
  );
  const normalized = validNodes.map((node) => {
    const width = Math.max(80, finite(node.width, 320)),
      height = Math.max(64, finite(node.height, 210));
    const x = finite(node.position.x),
      y = finite(node.position.y);
    return width === node.width &&
      height === node.height &&
      x === node.position.x &&
      y === node.position.y
      ? node
      : { ...node, width, height, position: { x, y } };
  });
  const nodes =
    normalized.length === input.nodes.length &&
    normalized.every((node, index) => node === input.nodes[index])
      ? input.nodes
      : normalized;
  const pairs = new Set<string>();
  const edgeIds = new Set<string>();
  const connections = input.connections.filter((edge) => {
    const pair = `${edge.fromNodeId}\0${edge.toNodeId}`;
    if (
      !ids.has(edge.fromNodeId) ||
      !ids.has(edge.toNodeId) ||
      edge.fromNodeId === edge.toNodeId ||
      pairs.has(pair) ||
      edgeIds.has(edge.id)
    )
      return false;
    pairs.add(pair);
    edgeIds.add(edge.id);
    return true;
  });
  const viewport = {
    x: finite(input.viewport.x),
    y: finite(input.viewport.y),
    k: Math.max(0.12, Math.min(3, finite(input.viewport.k, 1))),
  };
  return {
    ...input,
    nodes,
    connections:
      connections.length === input.connections.length
        ? input.connections
        : connections,
    viewport:
      viewport.x === input.viewport.x &&
      viewport.y === input.viewport.y &&
      viewport.k === input.viewport.k
        ? input.viewport
        : viewport,
  };
}

/** A synchronous command journal keeps event handlers, async jobs and explicit save on the same revision. */
export class StudioSession {
  private listeners = new Set<() => void>();
  private past: StudioDocument[] = [];
  private future: StudioDocument[] = [];
  private checkpoint: StudioDocument | null = null;
  private geometryIds: Set<string> | null = null;
  private current: StudioSnapshot;
  private closed = false;
  constructor(document: StudioDocument) {
    this.current = {
      document: normalizeStudioDocument(document),
      selection: new Set(),
      edge: null,
      undo: false,
      redo: false,
      revision: 0,
    };
  }
  read = () => this.current.document;
  snapshot = () => this.current;
  alive = () => !this.closed;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  dispose() {
    this.closed = true;
    this.listeners.clear();
  }
  private publish(
    document: StudioDocument,
    selection = this.current.selection,
    edge = this.current.edge,
  ) {
    if (this.closed) return;
    const sameNodes = document.nodes === this.current.document.nodes;
    const ids =
      sameNodes && selection === this.current.selection
        ? null
        : new Set(document.nodes.map((node) => node.id));
    this.current = {
      document,
      selection: ids
        ? new Set([...selection].filter((id) => ids.has(id)))
        : selection,
      edge:
        document.connections === this.current.document.connections &&
        edge === this.current.edge
          ? edge
          : document.connections.some((item) => item.id === edge)
            ? edge
            : null,
      undo: this.past.length > 0,
      redo: this.future.length > 0,
      revision: this.current.revision + 1,
    };
    for (const listener of this.listeners) listener();
  }
  /** Camera frames cannot change graph validity or undo history. Keep this path O(1). */
  moveViewport = (view: ViewportTransform) => {
    if (this.closed) return;
    const viewport = {
      x: finite(view.x),
      y: finite(view.y),
      k: Math.max(0.12, Math.min(3, finite(view.k, 1))),
    };
    const before = this.read();
    if (
      viewport.x === before.viewport.x &&
      viewport.y === before.viewport.y &&
      viewport.k === before.viewport.k
    )
      return;
    this.publish({ ...before, viewport });
  };
  private remember(document: StudioDocument) {
    this.past = [...this.past.slice(-99), document];
    this.future = [];
  }
  change = (
    recipe: (document: StudioDocument) => StudioDocument,
    history = true,
  ) => {
    if (this.closed) return;
    const before = this.read();
    const after = recipe(before);
    if (before === after) return;
    if (history && !this.checkpoint) this.remember(before);
    this.publish(normalizeStudioDocument(after));
  };
  beginGesture(ids?: Iterable<string>) {
    if (!this.checkpoint) {
      this.checkpoint = this.read();
      this.geometryIds = ids ? new Set(ids) : null;
    }
  }
  endGesture() {
    if (!this.checkpoint) return;
    const previous = this.checkpoint;
    const geometry = this.geometryIds;
    this.checkpoint = null;
    this.geometryIds = null;
    if (this.read() !== previous) {
      // A render or upload may finish during a drag. Undo the geometry without discarding that result.
      const oldNodes = new Map(previous.nodes.map((node) => [node.id, node]));
      const before = geometry
        ? {
            ...this.read(),
            nodes: this.read().nodes.map((node) => {
              const old = geometry.has(node.id)
                ? oldNodes.get(node.id)
                : undefined;
              return old
                ? {
                    ...node,
                    position: old.position,
                    width: old.width,
                    height: old.height,
                  }
                : node;
            }),
          }
        : previous;
      this.remember(before);
      this.publish(this.read());
    }
  }
  undo = () => {
    this.endGesture();
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.read());
    this.publish(previous);
  };
  redo = () => {
    this.endGesture();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.read());
    this.publish(next);
  };
  select(ids: Iterable<string>, edge: string | null = null) {
    const next = new Set(ids);
    if (
      this.current.edge === edge &&
      next.size === this.current.selection.size &&
      [...next].every((id) => this.current.selection.has(id))
    )
      return;
    this.publish(this.read(), next, edge);
  }
  patch(id: string, patch: Partial<CanvasNodeData>) {
    this.change((doc) => {
      const target = doc.nodes.find((node) => node.id === id);
      if (
        !target ||
        Object.entries(patch).every(
          ([key, value]) => target[key as keyof CanvasNodeData] === value,
        )
      )
        return doc;
      return {
        ...doc,
        nodes: doc.nodes.map((node) =>
          node === target ? { ...node, ...patch, id } : node,
        ),
      };
    });
  }
  metadata(id: string, patch: CanvasNodeMetadata, history = true) {
    this.change((doc) => {
      const target = doc.nodes.find((node) => node.id === id);
      if (
        !target ||
        Object.entries(patch).every(
          ([key, value]) =>
            target.metadata?.[key as keyof CanvasNodeMetadata] === value,
        )
      )
        return doc;
      return {
        ...doc,
        nodes: doc.nodes.map((node) =>
          node === target
            ? { ...node, metadata: { ...node.metadata, ...patch } }
            : node,
        ),
      };
    }, history);
  }
  insert = (nodes: CanvasNodeData[], connections: CanvasConnection[] = []) => {
    this.change((doc) => ({
      ...doc,
      nodes: [...doc.nodes, ...nodes],
      connections: [...doc.connections, ...connections],
    }));
    this.select(nodes.map((node) => node.id));
  };
  connect(from: string, to: string) {
    const doc = this.read();
    if (
      from === to ||
      !doc.nodes.some((n) => n.id === from) ||
      !doc.nodes.some((n) => n.id === to) ||
      doc.connections.some((e) => e.fromNodeId === from && e.toNodeId === to)
    )
      return false;
    const visited = new Set<string>();
    const queue = [to];
    while (queue.length) {
      const id = queue.shift()!;
      if (id === from) return false;
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(
        ...doc.connections
          .filter((e) => e.fromNodeId === id)
          .map((e) => e.toNodeId),
      );
    }
    this.change((value) => ({
      ...value,
      connections: [
        ...value.connections,
        { id: studioId(), fromNodeId: from, toNodeId: to },
      ],
    }));
    return true;
  }
  remove(ids: ReadonlySet<string> = this.current.selection) {
    const edge = ids.size ? null : this.current.edge;
    this.change((doc) => ({
      ...doc,
      nodes: doc.nodes
        .filter((node) => !ids.has(node.id))
        .map((node) =>
          ids.has(node.metadata?.groupId || "")
            ? { ...node, metadata: { ...node.metadata, groupId: undefined } }
            : node,
        ),
      connections: doc.connections.filter(
        (item) =>
          item.id !== edge &&
          !ids.has(item.fromNodeId) &&
          !ids.has(item.toNodeId),
      ),
    }));
    this.select([]);
  }
  clone(ids = this.current.selection) {
    const doc = this.read();
    const included = new Set(ids);
    for (const node of doc.nodes)
      if (included.has(node.metadata?.groupId || "")) included.add(node.id);
    let added = true;
    while (added) {
      added = false;
      for (const node of doc.nodes)
        if (
          !included.has(node.id) &&
          included.has(node.metadata?.groupId || "")
        ) {
          included.add(node.id);
          added = true;
        }
    }
    const mapping = new Map([...included].map((id) => [id, studioId()]));
    const nodes = doc.nodes
      .filter((node) => included.has(node.id))
      .map((node) => {
        const cloned = structuredClone(node);
        cloned.id = mapping.get(node.id)!;
        cloned.position = { x: node.position.x + 48, y: node.position.y + 48 };
        cloned.metadata = {
          ...cloned.metadata,
          groupId: mapping.get(node.metadata?.groupId || ""),
          prompt: node.metadata?.prompt?.replace(
            /@\[node:([^\]]+)\]/g,
            (_, id: string) => `@[node:${mapping.get(id) || id}]`,
          ),
          composerContent: node.metadata?.composerContent?.replace(
            /@\[node:([^\]]+)\]/g,
            (_, id: string) => `@[node:${mapping.get(id) || id}]`,
          ),
          ...(node.metadata?.status === "loading"
            ? { status: "idle", videoTaskId: undefined }
            : {}),
        };
        return cloned;
      });
    this.insert(
      nodes,
      doc.connections
        .filter(
          (edge) =>
            included.has(edge.fromNodeId) && included.has(edge.toNodeId),
        )
        .map((edge) => ({
          id: studioId(),
          fromNodeId: mapping.get(edge.fromNodeId)!,
          toNodeId: mapping.get(edge.toNodeId)!,
        })),
    );
  }
  group(title: string) {
    const picked = this.read().nodes.filter(
      (node) => this.current.selection.has(node.id) && node.type !== "group",
    );
    if (picked.length < 2) return;
    const left = Math.min(...picked.map((node) => node.position.x)) - 28;
    const top = Math.min(...picked.map((node) => node.position.y)) - 56;
    const frame = makeStudioNode("group", left, top, title);
    frame.width =
      Math.max(...picked.map((node) => node.position.x + node.width)) -
      left +
      28;
    frame.height =
      Math.max(...picked.map((node) => node.position.y + node.height)) -
      top +
      28;
    const ids = new Set(picked.map((node) => node.id));
    this.change((doc) => ({
      ...doc,
      nodes: [
        frame,
        ...doc.nodes.map((node) =>
          ids.has(node.id)
            ? { ...node, metadata: { ...node.metadata, groupId: frame.id } }
            : node,
        ),
      ],
    }));
    this.select([frame.id]);
  }
  ungroup() {
    const groups = new Set(
      this.read()
        .nodes.filter(
          (node) =>
            node.type === "group" && this.current.selection.has(node.id),
        )
        .map((node) => node.id),
    );
    if (!groups.size) return;
    this.change((doc) => ({
      ...doc,
      nodes: doc.nodes
        .filter((node) => !groups.has(node.id))
        .map((node) =>
          groups.has(node.metadata?.groupId || "")
            ? { ...node, metadata: { ...node.metadata, groupId: undefined } }
            : node,
        ),
      connections: doc.connections.filter(
        (edge) => !groups.has(edge.fromNodeId) && !groups.has(edge.toNodeId),
      ),
    }));
  }
  tidy() {
    const doc = this.read();
    const scope =
      this.current.selection.size > 1
        ? this.current.selection
        : new Set(
            doc.nodes
              .filter((node) => !node.metadata?.groupId)
              .map((node) => node.id),
          );
    const ordered = doc.nodes.filter((node) => scope.has(node.id));
    if (!ordered.length) return;
    const columns = Math.ceil(Math.sqrt(ordered.length));
    const maxWidth = Math.max(...ordered.map((node) => node.width)) + 120;
    const maxHeight = Math.max(...ordered.map((node) => node.height)) + 100;
    const spots = new Map(
      ordered.map((node, index) => [
        node.id,
        {
          x: (index % columns) * maxWidth,
          y: Math.floor(index / columns) * maxHeight,
        },
      ]),
    );
    this.change((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        const parent = node.metadata?.groupId
          ? current.nodes.find((item) => item.id === node.metadata?.groupId)
          : undefined;
        const parentSpot = parent ? spots.get(parent.id) : undefined;
        const position =
          spots.get(node.id) ??
          (parent && parentSpot
            ? {
                x: node.position.x + parentSpot.x - parent.position.x,
                y: node.position.y + parentSpot.y - parent.position.y,
              }
            : undefined);
        return position ? { ...node, position } : node;
      }),
    }));
  }
}

export function fitStudioView(
  nodes: readonly CanvasNodeData[],
  width: number,
  height: number,
): ViewportTransform {
  if (!nodes.length) return { x: width / 2 - 160, y: height / 2 - 100, k: 1 };
  const x = Math.min(...nodes.map((node) => node.position.x));
  const y = Math.min(...nodes.map((node) => node.position.y));
  const w = Math.max(...nodes.map((node) => node.position.x + node.width)) - x;
  const h = Math.max(...nodes.map((node) => node.position.y + node.height)) - y;
  const k = Math.max(
    0.12,
    Math.min(
      1.2,
      (width - 100) / Math.max(1, w),
      (height - 140) / Math.max(1, h),
    ),
  );
  return { x: (width - w * k) / 2 - x * k, y: (height - h * k) / 2 - y * k, k };
}
