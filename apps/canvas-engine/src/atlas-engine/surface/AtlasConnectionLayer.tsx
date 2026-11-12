import { memo, useId, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import type {
  CanvasConnection,
  CanvasNodeData,
  ConnectionHandle,
  Position,
} from "@/types/canvas";

type NodeLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function box(node: CanvasNodeData): NodeLike {
  return { x: node.position.x, y: node.position.y, width: node.width, height: node.height };
}

function port(node: NodeLike, side: "left" | "right") {
  return { x: node.x + (side === "right" ? node.width : 0), y: node.y + node.height / 2 };
}

function curve(source: NodeLike, target: NodeLike) {
  const forward = target.x + target.width / 2 >= source.x + source.width / 2;
  const start = port(source, forward ? "right" : "left");
  const end = port(target, forward ? "left" : "right");
  const reach = Math.max(48, Math.abs(end.x - start.x) * 0.45);
  const direction = end.x >= start.x ? 1 : -1;
  return {
    path: `M ${start.x} ${start.y} C ${start.x + reach * direction} ${start.y}, ${end.x - reach * direction} ${end.y}, ${end.x} ${end.y}`,
  };
}

type EdgeProps = {
  connection: CanvasConnection;
  from: CanvasNodeData;
  to: CanvasNodeData;
  active: boolean;
  onSelect: () => void;
  onContextMenu?: (event: MouseEvent<SVGPathElement>) => void;
};

export const AtlasConnectionPath = memo(function AtlasConnectionPath({
  connection,
  from,
  to,
  active,
  onSelect,
  onContextMenu,
}: EdgeProps) {
  const markerId = `atlas-edge-${useId().replace(/:/g, "")}`;
  const route = useMemo(() => curve(box(from), box(to)), [from, to]);
  const color = active ? "var(--atlas-edge-active, #7aa7ff)" : "var(--atlas-edge, #66738e)";
  const activate = (event: MouseEvent<SVGPathElement>) => {
    event.stopPropagation();
    onSelect();
  };
  const keyboard = (event: KeyboardEvent<SVGPathElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  };
  return (
    <g data-atlas-connection={connection.id}>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      <path
        data-connection-id={connection.id}
        d={route.path}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        pointerEvents="stroke"
        role="button"
        tabIndex={0}
        aria-label={`连接 ${from.title || from.id} 到 ${to.title || to.id}`}
        onClick={activate}
        onKeyDown={keyboard}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu?.(event);
        }}
      />
      <path
        d={route.path}
        fill="none"
        stroke={color}
        strokeWidth={active ? 3 : 2}
        strokeDasharray={active ? undefined : "7 4"}
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
        pointerEvents="none"
      />
    </g>
  );
});

type PreviewProps = {
  node?: CanvasNodeData;
  handle: ConnectionHandle;
  mouseWorld: Position;
  target?: CanvasNodeData;
};

export const AtlasActiveConnectionPath = memo(function AtlasActiveConnectionPath({
  node,
  handle,
  mouseWorld,
  target,
}: PreviewProps) {
  if (!node) return null;
  const source = box(node);
  const destination = target ? box(target) : undefined;
  const sourcePoint = port(source, handle.handleType === "source" ? "right" : "left");
  const targetPoint = destination
    ? port(destination, handle.handleType === "source" ? "left" : "right")
    : mouseWorld;
  const start = handle.handleType === "source" ? sourcePoint : targetPoint;
  const end = handle.handleType === "source" ? targetPoint : sourcePoint;
  return <path data-atlas-connection-preview d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} stroke="var(--atlas-edge-active, #7aa7ff)" strokeWidth={2} strokeLinecap="round" fill="none" strokeDasharray="5 6" pointerEvents="none" />;
});
