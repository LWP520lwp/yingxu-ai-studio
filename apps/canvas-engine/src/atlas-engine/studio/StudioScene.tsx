import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  FileText,
  Film,
  Image,
  Music2,
  SlidersHorizontal,
  Layers,
  LoaderCircle,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CanvasNodeData, Position } from "@/types/canvas";
import type { StudioDocument } from "./studio-document";
import "./studio-scene.css";

export type StudioWire = {
  nodeId: string;
  side: "source" | "target";
  cursor: Position;
};
export type StudioMarquee = { from: Position; to: Position };
export type StudioCorner = "nw" | "ne" | "sw" | "se";
type Props = {
  document: StudioDocument;
  selection: ReadonlySet<string>;
  edge: string | null;
  size: { width: number; height: number };
  wire: StudioWire | null;
  marquee: StudioMarquee | null;
  interaction?: string | null;
  onNodeDown: (event: PointerEvent, node: CanvasNodeData) => void;
  onSelect: (id: string) => void;
  onEdge: (id: string) => void;
  onConnect: (
    event: PointerEvent,
    id: string,
    side: "source" | "target",
  ) => void;
  onResize: (
    event: PointerEvent,
    node: CanvasNodeData,
    corner: StudioCorner,
  ) => void;
  onTitle: (id: string, title: string) => void;
  onContent: (id: string, text: string) => void;
  onAction: (action: string, node: CanvasNodeData) => void;
  renderExtension: (node: CanvasNodeData) => ReactNode;
};
type NodeEvents = Pick<
  Props,
  | "onNodeDown"
  | "onSelect"
  | "onConnect"
  | "onResize"
  | "onTitle"
  | "onContent"
  | "onAction"
  | "renderExtension"
>;
const glyphs = {
  text: FileText,
  image: Image,
  video: Film,
  audio: Music2,
  config: SlidersHorizontal,
  group: Layers,
};
export function studioPortPosition(
  node: CanvasNodeData,
  side: "source" | "target",
): Position {
  return {
    x: node.position.x + (side === "source" ? node.width : 0),
    y: node.position.y + Math.min(74, node.height / 2),
  };
}
export function studioWirePath(from: Position, to: Position) {
  const reach = Math.max(64, Math.min(320, Math.abs(to.x - from.x) * 0.55));
  return `M${from.x},${from.y} C${from.x + reach},${from.y} ${to.x - reach},${to.y} ${to.x},${to.y}`;
}

const StudioNode = memo(
  function StudioNode({
    node,
    selected,
    connectionSide,
    connectionHover,
    props,
  }: {
    node: CanvasNodeData;
    selected: boolean;
    connectionSide?: "source" | "target";
    connectionHover: boolean;
    props: NodeEvents;
  }) {
    const { i18n } = useTranslation();
    const zh = !i18n.resolvedLanguage?.startsWith("en");
    const [editor, setEditor] = useState<"title" | "content" | null>(null);
    const [draft, setDraft] = useState("");
    const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    useEffect(() => {
      if (editor) {
        input.current?.focus();
        input.current?.select();
      }
    }, [editor]);
    const meta = node.metadata || {};
    const Icon = glyphs[node.type as keyof typeof glyphs] || SlidersHorizontal;
    const startEdit = (field: "title" | "content") => {
      props.onSelect(node.id);
      setDraft(field === "title" ? node.title : meta.content || "");
      setEditor(field);
    };
    const finish = () => {
      if (editor === "title")
        props.onTitle(node.id, draft.trim().slice(0, 200) || node.title);
      if (editor === "content") props.onContent(node.id, draft);
      setEditor(null);
    };
    const interactive = (event: { stopPropagation(): void }) =>
      event.stopPropagation();
    const commonEditor = {
      value: draft,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => setDraft(event.target.value),
      onBlur: finish,
      onMouseDown: interactive,
      onKeyDown: (event: React.KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          setEditor(null);
        }
        if (
          event.key === "Enter" &&
          (editor === "title" || event.ctrlKey || event.metaKey)
        ) {
          event.preventDefault();
          finish();
        }
      },
    };
    const group = node.type === "group";
    const content = meta.content || "";
    return (
      <article
        data-node-id={node.id}
        data-studio-node={node.type}
        className={`studio-node ${selected ? "is-selected" : ""} ${group ? "is-group" : ""}`}
        style={{
          transform: `translate3d(${node.position.x}px, ${node.position.y}px, 0)`,
          width: node.width,
          height: node.height,
          zIndex: group ? 1 : selected ? 4 : 3,
        }}
        onPointerDown={(event) => props.onNodeDown(event, node)}
        tabIndex={0}
        aria-label={`${zh ? "节点" : "Node"}: ${node.title}`}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || event.key !== "Enter")
            return;
          event.preventDefault();
          props.onSelect(node.id);
        }}
      >
        <header className="studio-node-heading">
          <Icon size={15} aria-hidden="true" />
          {editor === "title" ? (
            <input
              {...commonEditor}
              ref={(el) => {
                input.current = el;
              }}
              aria-label={zh ? "节点名称" : "Node name"}
            />
          ) : (
            <button
              type="button"
              onDoubleClick={() => startEdit("title")}
              title={zh ? "双击重命名" : "Double-click to rename"}
            >
              {node.title}
            </button>
          )}
          <span
            className={`studio-node-state state-${meta.status || "idle"}`}
            title={meta.errorDetails}
          >
            {meta.status === "loading" ? (
              <LoaderCircle size={13} className="studio-spin" />
            ) : meta.status === "error" ? (
              <AlertCircle size={13} />
            ) : (
              <span />
            )}
          </span>
        </header>
        {!group && (
          <div
            className="studio-node-body"
            onDoubleClick={() =>
              node.type === "text"
                ? startEdit("content")
                : props.onAction("preview", node)
            }
          >
            {node.type === "text" ? (
              editor === "content" ? (
                <textarea
                  {...commonEditor}
                  ref={(el) => {
                    input.current = el;
                  }}
                  aria-label={zh ? "编辑节点文本" : "Edit node text"}
                />
              ) : (
                <div
                  className="studio-node-text"
                  style={{ fontSize: meta.fontSize || 15 }}
                >
                  {content ||
                    (zh
                      ? "双击这里，写下你的想法。"
                      : "Double-click to start writing.")}
                </div>
              )
            ) : node.type === "image" && content ? (
              <img
                draggable={false}
                src={content}
                alt={node.title}
                loading="lazy"
              />
            ) : node.type === "video" && content ? (
              <video
                src={content}
                controls
                preload="metadata"
                onMouseDown={interactive}
              />
            ) : node.type === "audio" && content ? (
              <div className="studio-audio">
                <Music2 size={32} />
                <audio
                  src={content}
                  controls
                  preload="metadata"
                  onMouseDown={interactive}
                />
              </div>
            ) : node.type === "config" ? (
              <div className="studio-config-summary">
                <span>{(meta.generationMode || "image").toUpperCase()}</span>
                <p>
                  {meta.composerContent ||
                    meta.prompt ||
                    (zh
                      ? "点击节点，填写创作要求、选择模型与 Skill。"
                      : "Click this node to describe the scene and choose a model or Skill.")}
                </p>
                <small>
                  {meta.model?.replace(/^platform::/, "") ||
                    (zh ? "等待选择模型" : "Choose a model")}
                </small>
              </div>
            ) : (
              props.renderExtension(node) || (
                <div className="studio-node-placeholder">
                  <Icon size={30} strokeWidth={1.2} />
                  <span>
                    {zh
                      ? "点击节点开始创作，或从左侧添加参考素材"
                      : "Click to create, or add references from the left library"}
                  </span>
                </div>
              )
            )}
          </div>
        )}
        {meta.errorDetails && (
          <div className="studio-node-error" role="status">
            {meta.errorDetails}
          </div>
        )}
        {selected && meta.images && meta.images.length > 1 && (
          <div className="studio-batch" onMouseDown={interactive}>
            {meta.images.map((image) => (
              <button
                type="button"
                key={image.id}
                aria-label={`${zh ? "选择结果" : "Select result"} ${image.id}`}
                onClick={() => props.onAction(`primary:${image.id}`, node)}
              >
                {image.content ? (
                  <img src={image.content} alt="" />
                ) : (
                  image.status
                )}
              </button>
            ))}
          </div>
        )}
        {(["target", "source"] as const).map((side) => (
          <button
            type="button"
            key={side}
            className={`studio-port studio-port-${side}`}
            data-studio-port={node.id}
            data-port-side={side}
            data-connect-ready={connectionSide === side || undefined}
            data-connect-hover={
              (connectionSide === side && connectionHover) || undefined
            }
            style={{ top: Math.min(74, node.height / 2) }}
            aria-label={
              zh
                ? `${side === "source" ? "输出" : "输入"}连接：${node.title}`
                : `${side === "source" ? "Output" : "Input"}: ${node.title}`
            }
            onPointerDown={(event) => props.onConnect(event, node.id, side)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                props.onAction(`port:${side}`, node);
              }
            }}
          />
        ))}
        {selected &&
          (["nw", "ne", "sw", "se"] as const).map((corner) => (
            <button
              type="button"
              key={corner}
              className={`studio-resize studio-resize-${corner}`}
              aria-label={`${zh ? "调整尺寸" : "Resize"} ${corner}`}
              onMouseDown={interactive}
              onPointerDown={(event) => props.onResize(event, node, corner)}
            />
          ))}
      </article>
    );
  },
  (previous, next) =>
    previous.node === next.node &&
    previous.selected === next.selected &&
    previous.connectionSide === next.connectionSide &&
    previous.connectionHover === next.connectionHover &&
    Object.hasOwn(glyphs, next.node.type),
);

export function StudioScene(props: Props) {
  const { document: doc, selection, size, wire, marquee } = props;
  const view = doc.viewport;
  const nodes = useMemo(
    () => new Map(doc.nodes.map((node) => [node.id, node])),
    [doc.nodes],
  );
  const latest = useRef(props);
  latest.current = props;
  // Memoised cards always invoke the current command closures, never stale config or selection.
  const events = useMemo<NodeEvents>(
    () => ({
      onNodeDown: (...args) => latest.current.onNodeDown(...args),
      onSelect: (...args) => latest.current.onSelect(...args),
      onConnect: (...args) => latest.current.onConnect(...args),
      onResize: (...args) => latest.current.onResize(...args),
      onTitle: (...args) => latest.current.onTitle(...args),
      onContent: (...args) => latest.current.onContent(...args),
      onAction: (...args) => latest.current.onAction(...args),
      renderExtension: (...args) => latest.current.renderExtension(...args),
    }),
    [],
  );
  const connectable = useMemo(() => {
    if (!wire) return null;
    const blocked = new Set([wire.nodeId]);
    const adjacency = new Map<string, string[]>();
    for (const edge of doc.connections) {
      const from = wire.side === "source" ? edge.toNodeId : edge.fromNodeId;
      const to = wire.side === "source" ? edge.fromNodeId : edge.toNodeId;
      adjacency.set(from, [...(adjacency.get(from) || []), to]);
      if (
        (wire.side === "source" ? edge.fromNodeId : edge.toNodeId) ===
        wire.nodeId
      )
        blocked.add(wire.side === "source" ? edge.toNodeId : edge.fromNodeId);
    }
    const pending = [wire.nodeId];
    const visited = new Set(pending);
    for (let i = 0; i < pending.length; i++)
      for (const id of adjacency.get(pending[i]) || []) {
        blocked.add(id);
        if (!visited.has(id)) {
          visited.add(id);
          pending.push(id);
        }
      }
    return blocked;
  }, [wire?.nodeId, wire?.side, doc.connections]);
  const left = (-view.x - 500) / view.k;
  const top = (-view.y - 500) / view.k;
  const right = (size.width - view.x + 500) / view.k;
  const bottom = (size.height - view.y + 500) / view.k;
  const visible = doc.nodes.filter(
    (node) =>
      selection.has(node.id) ||
      (node.position.x + node.width >= left &&
        node.position.x <= right &&
        node.position.y + node.height >= top &&
        node.position.y <= bottom),
  );
  const visibleIds = new Set(visible.map((node) => node.id));
  const source = wire ? nodes.get(wire.nodeId) : undefined;
  const { i18n } = useTranslation();
  const zh = !i18n.resolvedLanguage?.startsWith("en");
  return (
    <>
      <svg
        className="studio-wires"
        aria-label={zh ? "画布连接" : "Canvas connections"}
      >
        <defs>
          <marker
            id="studio-flow-arrow"
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path
              d="M2 2 L10 6 L2 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </marker>
        </defs>
        {doc.connections.map((edge) => {
          const from = nodes.get(edge.fromNodeId);
          const to = nodes.get(edge.toNodeId);
          if (
            !from ||
            !to ||
            (!visibleIds.has(from.id) && !visibleIds.has(to.id))
          )
            return null;
          const path = studioWirePath(
            studioPortPosition(from, "source"),
            studioPortPosition(to, "target"),
          );
          const active =
            edge.id === props.edge ||
            selection.has(from.id) ||
            selection.has(to.id);
          return (
            <g key={edge.id} className={active ? "is-active" : ""}>
              <path
                className="studio-wire-hit"
                d={path}
                tabIndex={0}
                role="button"
                data-connection-id={edge.id}
                aria-label={`${zh ? "连接" : "Connect"} ${from.title} → ${to.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onEdge(edge.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onEdge(edge.id);
                  }
                }}
              />
              <path
                className="studio-wire"
                d={path}
                markerEnd="url(#studio-flow-arrow)"
              />
            </g>
          );
        })}
        {wire && source && (
          <path
            className="studio-wire studio-wire-draft"
            d={
              wire.side === "source"
                ? studioWirePath(
                    studioPortPosition(source, "source"),
                    wire.cursor,
                  )
                : studioWirePath(
                    wire.cursor,
                    studioPortPosition(source, "target"),
                  )
            }
          />
        )}
      </svg>
      {visible.map((node) => (
        <StudioNode
          key={node.id}
          node={node}
          selected={selection.has(node.id)}
          connectionSide={
            wire && connectable && !connectable.has(node.id)
              ? wire.side === "source"
                ? "target"
                : "source"
              : undefined
          }
          connectionHover={Boolean(
            wire &&
            Math.abs(
              wire.cursor.x -
                studioPortPosition(
                  node,
                  wire.side === "source" ? "target" : "source",
                ).x,
            ) <
              40 / view.k &&
            Math.abs(wire.cursor.y - studioPortPosition(node, "target").y) <
              40 / view.k,
          )}
          props={events}
        />
      ))}
      {marquee && (
        <div
          className="studio-marquee"
          style={{
            left: Math.min(marquee.from.x, marquee.to.x),
            top: Math.min(marquee.from.y, marquee.to.y),
            width: Math.abs(marquee.to.x - marquee.from.x),
            height: Math.abs(marquee.to.y - marquee.from.y),
          }}
        />
      )}
    </>
  );
}
