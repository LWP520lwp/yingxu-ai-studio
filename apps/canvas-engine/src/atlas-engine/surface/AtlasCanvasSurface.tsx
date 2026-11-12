import { useMemo, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { edgePath, nearestPort, screenToWorld, translateViewport, zoomAround } from "./geometry";
import { createAtlasSelection, nodeStyle, reduceAtlasSelection, type AtlasDocument, type AtlasEdge, type AtlasNode, type AtlasPort, type AtlasPoint, type AtlasSurfaceSelection, type AtlasViewport } from "./model";

export type AtlasCanvasSurfaceProps = {
  document: AtlasDocument;
  selection?: AtlasSurfaceSelection;
  onSelectionChange?: (selection: AtlasSurfaceSelection) => void;
  onDocumentChange?: (document: AtlasDocument) => void;
  onNodeDoubleClick?: (node: AtlasNode) => void;
  renderNode?: (node: AtlasNode) => ReactNode;
  className?: string;
};

type Gesture = Readonly<{ pointerId: number; point: AtlasPoint; viewport: AtlasViewport }>;
type PendingLink = Readonly<{ nodeId: string; port: AtlasPort; point: AtlasPoint }>;

const PORTS: readonly AtlasPort[] = ["top", "right", "bottom", "left"];

export function AtlasCanvasSurface({ document, selection = createAtlasSelection(), onSelectionChange, onDocumentChange, onNodeDoubleClick, renderNode, className }: AtlasCanvasSurfaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>();
  const [pendingLink, setPendingLink] = useState<PendingLink>();
  const [space, setSpace] = useState(false);

  const nodeMap = useMemo(() => new Map(document.nodes.map((node) => [node.id, node])), [document.nodes]);
  const edgeEntries = useMemo(() => document.edges.flatMap((edge) => {
    const from = nodeMap.get(edge.from); const to = nodeMap.get(edge.to);
    return from && to ? [{ edge, from, to }] : [];
  }), [document.edges, nodeMap]);

  const emitSelection = (next: AtlasSurfaceSelection) => onSelectionChange?.(next);
  const emitDocument = (next: AtlasDocument) => onDocumentChange?.(next);
  const pointInHost = (event: { clientX: number; clientY: number }): AtlasPoint => {
    const rect = host.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("input,textarea,button,[data-atlas-stop-wheel]")) return;
    event.preventDefault();
    emitDocument({ ...document, viewport: zoomAround(document.viewport, pointInHost(event), Math.exp(-event.deltaY * 0.0015)) });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target.closest("[data-atlas-port]")) return;
    const background = !target.closest("[data-atlas-node], [data-atlas-edge]");
    if (event.button === 1 || (event.button === 0 && background && (space || target.closest("[data-atlas-pan]")))) {
      event.preventDefault();
      const point = pointInHost(event);
      setGesture({ pointerId: event.pointerId, point, viewport: document.viewport });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 0 && background) emitSelection(createAtlasSelection());
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = pointInHost(event);
    emitDocument({ ...document, viewport: translateViewport(gesture.viewport, { x: point.x - gesture.point.x, y: point.y - gesture.point.y }) });
  };

  const endGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture?.pointerId === event.pointerId) setGesture(undefined);
  };

  const onNodePointerDown = (event: PointerEvent<HTMLDivElement>, node: AtlasNode) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    emitSelection(reduceAtlasSelection(selection, { type: "select-node", nodeId: node.id, additive: event.shiftKey }));
  };

  const startLink = (event: PointerEvent<HTMLButtonElement>, node: AtlasNode, port: AtlasPort) => {
    event.stopPropagation(); event.preventDefault();
    setPendingLink({ nodeId: node.id, port, point: node.position });
  };

  const finishLink = (event: PointerEvent<HTMLButtonElement>, node: AtlasNode, port: AtlasPort) => {
    event.stopPropagation(); event.preventDefault();
    if (!pendingLink || pendingLink.nodeId === node.id) { setPendingLink(undefined); return; }
    const id = `edge-${pendingLink.nodeId}-${node.id}-${Date.now().toString(36)}`;
    emitDocument({ ...document, edges: [...document.edges, { id, from: pendingLink.nodeId, to: node.id, fromPort: pendingLink.port, toPort: port }] });
    setPendingLink(undefined);
  };

  return <div
    ref={host}
    data-atlas-surface
    data-atlas-pan
    className={`relative h-full w-full overflow-hidden select-none bg-[var(--atlas-canvas-bg,#0b1020)] ${className ?? ""}`}
    onWheel={onWheel}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={endGesture}
    onPointerCancel={endGesture}
    onKeyDown={(event) => { if (event.code === "Space") setSpace(true); }}
    onKeyUp={(event) => { if (event.code === "Space") setSpace(false); }}
    tabIndex={0}
  >
    <div className="pointer-events-none absolute inset-0 opacity-35" style={{ backgroundImage: "linear-gradient(var(--atlas-grid,#23304d) 1px, transparent 1px), linear-gradient(90deg, var(--atlas-grid,#23304d) 1px, transparent 1px)", backgroundSize: `${48 * document.viewport.scale}px ${48 * document.viewport.scale}px`, backgroundPosition: `${document.viewport.x}px ${document.viewport.y}px` }} />
    <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate3d(${document.viewport.x}px, ${document.viewport.y}px, 0) scale(${document.viewport.scale})` }}>
      <svg className="pointer-events-none absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible">
        {edgeEntries.map(({ edge, from, to }) => <path key={edge.id} data-atlas-edge={edge.id} d={edgePath(edge, from, to)} fill="none" stroke={selection.edgeId === edge.id ? "#7aa7ff" : "#66738e"} strokeWidth={selection.edgeId === edge.id ? 3 : 2} strokeDasharray={selection.edgeId === edge.id ? undefined : "7 5"} pointerEvents="stroke" onClick={(event) => { event.stopPropagation(); emitSelection(reduceAtlasSelection(selection, { type: "select-edge", edgeId: edge.id })); }} />)}
      </svg>
      {document.nodes.map((node) => <div key={node.id} data-atlas-node={node.id} className="absolute rounded-xl border bg-[var(--atlas-node-bg,#131b2e)] text-[var(--atlas-node-text,#e5edff)]" style={nodeStyle(node, selection.nodeIds.includes(node.id), document.viewport.scale)} onPointerDown={(event) => onNodePointerDown(event, node)} onDoubleClick={() => onNodeDoubleClick?.(node)}>
        <div className="flex h-9 items-center justify-between border-b border-white/10 px-3 text-xs font-semibold"><span className="truncate">{node.title}</span><span className="ml-2 size-2 rounded-full" style={{ background: node.color ?? "#6f8cff" }} /></div>
        <div className="h-[calc(100%-36px)] overflow-auto p-3 text-sm">{renderNode ? renderNode(node) : node.content || node.kind}</div>
        {PORTS.map((port) => <button key={port} type="button" data-atlas-port={`${node.id}:${port}`} aria-label={`${node.title} ${port} connector`} className={`absolute size-3 rounded-full border-2 border-[var(--atlas-canvas-bg,#0b1020)] bg-[var(--atlas-port,#8ca8ff)] ${port === "top" ? "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" : port === "right" ? "right-0 top-1/2 translate-x-1/2 -translate-y-1/2" : port === "bottom" ? "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2" : "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"}`} onPointerDown={(event) => pendingLink ? finishLink(event, node, port) : startLink(event, node, port)} onDoubleClick={(event) => { event.stopPropagation(); setPendingLink(undefined); }} />)}
      </div>)}
    </div>
  </div>;
}
