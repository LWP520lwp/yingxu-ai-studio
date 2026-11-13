import {
  memo,
  useId,
  useMemo,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  CanvasConnection,
  CanvasNodeData,
  ConnectionHandle,
  Position,
} from "@/types/canvas";
import {
  routeCanvasConnection,
  routeConnectionPreview,
  type AtlasConnectionBox,
} from "./connection-routing";

function bounds(node: CanvasNodeData): AtlasConnectionBox {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
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
  const { t } = useTranslation();
  const markerId = `atlas-arrow-${useId().replace(/:/g, "")}`;
  const route = useMemo(
    () => routeCanvasConnection(bounds(from), bounds(to)),
    [from, to],
  );
  const color = active
    ? "var(--atlas-edge-active, #7aa7ff)"
    : "var(--atlas-edge, #66738e)";

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
  const openMenu = (event: MouseEvent<SVGPathElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onContextMenu?.(event);
  };

  return (
    <g data-atlas-connection={connection.id}>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path
            d="M 1 1 L 9 5 L 1 9"
            fill="none"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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
        aria-label={t("canvas.connectionLabel", {
          from: from.title || from.id,
          to: to.title || to.id,
        })}
        onClick={activate}
        onKeyDown={keyboard}
        onContextMenu={openMenu}
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
        style={{
          filter: active ? `drop-shadow(0 0 7px ${color}66)` : undefined,
        }}
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

export const AtlasActiveConnectionPath = memo(
  function AtlasActiveConnectionPath({
    node,
    handle,
    mouseWorld,
    target,
  }: PreviewProps) {
    const route = useMemo(() => {
      if (!node) return undefined;
      if (target) {
        const source = handle.handleType === "source" ? node : target;
        const destination = handle.handleType === "source" ? target : node;
        return routeCanvasConnection(bounds(source), bounds(destination));
      }
      return routeConnectionPreview(
        bounds(node),
        handle.handleType,
        mouseWorld,
      );
    }, [handle.handleType, mouseWorld.x, mouseWorld.y, node, target]);
    if (!route) return null;
    return (
      <path
        data-atlas-connection-preview
        d={route.path}
        stroke="var(--atlas-edge-active, #7aa7ff)"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
        strokeDasharray="5 6"
        pointerEvents="none"
      />
    );
  },
);
