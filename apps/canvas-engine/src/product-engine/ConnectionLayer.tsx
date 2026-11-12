import { memo, useId, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";
import { edgeCurve, previewEdgeCurve } from "./geometry";
import type { ProductNode } from "./document";

function asProductNode(node: CanvasNodeData): ProductNode {
  return {
    id: node.id,
    kind: node.type,
    title: node.title,
    frame: { ...node.position, width: node.width, height: node.height },
    data: node.metadata ?? {},
  };
}

type ConnectionProps = {
  connection: CanvasConnection;
  from: CanvasNodeData;
  to: CanvasNodeData;
  active: boolean;
  onSelect: () => void;
  onContextMenu?: (event: MouseEvent<SVGPathElement>) => void;
};

export const ProductConnectionPath = memo(function ProductConnectionPath({ connection, from, to, active, onSelect, onContextMenu }: ConnectionProps) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const marker = `product-edge-${useId().replace(/:/g, "")}`;
  const route = useMemo(() => edgeCurve(asProductNode(from), asProductNode(to)), [from, to]);
  const color = active ? theme.node.activeStroke : theme.node.muted;

  const activate = (event: MouseEvent<SVGPathElement>) => {
    event.stopPropagation();
    onSelect();
  };
  const context = (event: MouseEvent<SVGPathElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onContextMenu?.(event);
  };
  const keyboard = (event: KeyboardEvent<SVGPathElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  };

  return (
    <g data-connection-group={connection.id}>
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      <path
        data-connection-id={connection.id}
        d={route.path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        pointerEvents="stroke"
        role="button"
        tabIndex={0}
        aria-label={`连接 ${from.title || from.id} 到 ${to.title || to.id}`}
        style={{ cursor: "pointer" }}
        onClick={activate}
        onKeyDown={keyboard}
        onContextMenu={context}
      />
      <path
        d={route.path}
        fill="none"
        stroke={color}
        strokeWidth={active ? 3 : 2}
        strokeDasharray={active ? undefined : "7 4"}
        strokeLinecap="round"
        markerEnd={`url(#${marker})`}
        pointerEvents="none"
        style={{ filter: active ? `drop-shadow(0 0 7px ${color}66)` : undefined }}
      />
    </g>
  );
});

type PreviewProps = { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData };

export const ProductActiveConnectionPath = memo(function ProductActiveConnectionPath({ node, handle, mouseWorld, target }: PreviewProps) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const route = useMemo(() => node
    ? previewEdgeCurve(asProductNode(node), handle.handleType, mouseWorld, target ? asProductNode(target) : undefined)
    : null,
  [handle.handleType, mouseWorld, node, target]);
  if (!route) return null;
  return <path data-connection-preview d={route.path} stroke={theme.node.activeStroke} strokeWidth={2} strokeLinecap="round" fill="none" strokeDasharray="5 6" pointerEvents="none" />;
});
