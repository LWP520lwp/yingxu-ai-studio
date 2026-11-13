import { memo } from "react";
import { useTranslation } from "react-i18next";

import { getAtlasNodeDefinition } from "@/atlas-engine/model/node-registry";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type {
  CanvasConnection,
  CanvasNodeData,
  ConnectionHandle,
  Position,
  SelectionBox,
} from "@/types/canvas";
import { AtlasNodeCard } from "./AtlasNodeCard";
import {
  AtlasConnectionPath,
  AtlasActiveConnectionPath,
} from "./AtlasConnectionLayer";
import type { AtlasNodeCardProps } from "./atlas-node-card-contracts";
import {
  atlasMarqueeBounds,
  atlasSceneNodeView,
  type AtlasScenePresentation,
  type AtlasSceneReferences,
  type AtlasSceneSelection,
} from "./scene-model";

type NodeEvents = Pick<
  AtlasNodeCardProps,
  | "onMouseDown"
  | "onSelectCapture"
  | "onHoverStart"
  | "onHoverEnd"
  | "onConnectStart"
  | "onResizeStart"
  | "onResize"
  | "onResizeEnd"
  | "onContentChange"
  | "onTitleChange"
  | "onToggleBatch"
  | "onSetBatchPrimary"
  | "onDuplicateBatchImage"
  | "onDownloadBatchImage"
  | "onRetryBatchImage"
  | "onDeleteBatchImage"
  | "onRetry"
  | "onViewImage"
  | "onSelectReference"
  | "onContextMenu"
  | "renderPanel"
  | "renderNodeContent"
  | "pluginHost"
  | "registryVersion"
>;

type SceneEdge = {
  connection: CanvasConnection;
  from: CanvasNodeData;
  to: CanvasNodeData;
};

type Props = {
  nodes: CanvasNodeData[];
  edges: SceneEdge[];
  selection: AtlasSceneSelection;
  presentation: AtlasScenePresentation;
  references: AtlasSceneReferences;
  gesture: {
    handle: ConnectionHandle;
    node?: CanvasNodeData;
    target?: CanvasNodeData;
    cursor: Position;
  } | null;
  marquee: SelectionBox | null;
  events: NodeEvents;
  onSelectEdge: (id: string, point?: Position) => void;
};

const SceneNode = memo(AtlasNodeCard);

export function AtlasBoardScene({
  nodes,
  edges,
  selection,
  presentation,
  references,
  gesture,
  marquee,
  events,
  onSelectEdge,
}: Props) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const wire = gesture
    ? { source: gesture.handle.nodeId, target: gesture.target?.id ?? null }
    : null;

  return (
    <>
      <svg
        aria-label={t("canvas.connectionsLabel")}
        className="canvas-atlas-connections absolute inset-0 overflow-visible"
        width="100%"
        height="100%"
        style={{ pointerEvents: "none", zIndex: 0 }}
      >
        {edges.map(({ connection, from, to }) => (
          <AtlasConnectionPath
            key={connection.id}
            connection={connection}
            from={from}
            to={to}
            active={
              selection.edge === connection.id ||
              selection.relatedEdges.has(connection.id)
            }
            onSelect={() => onSelectEdge(connection.id)}
            onContextMenu={(event) =>
              onSelectEdge(connection.id, {
                x: event.clientX,
                y: event.clientY,
              })
            }
          />
        ))}
        {gesture && (
          <AtlasActiveConnectionPath
            handle={gesture.handle}
            node={gesture.node}
            target={gesture.target}
            mouseWorld={gesture.cursor}
          />
        )}
      </svg>
      {nodes.map((node) => (
        <SceneNode
          key={node.id}
          {...atlasSceneNodeView(
            node,
            selection,
            presentation,
            references,
            wire,
            !getAtlasNodeDefinition(node.type)?.hidePanel,
          )}
          {...events}
        />
      ))}
      {marquee && (
        <div
          aria-hidden="true"
          data-atlas-marquee
          className="pointer-events-none absolute z-[100] box-border border border-dashed"
          style={{
            ...atlasMarqueeBounds(marquee),
            background: theme.canvas.selectionFill,
            borderColor: theme.canvas.selectionStroke,
            borderWidth: 1 / presentation.scale,
          }}
        />
      )}
    </>
  );
}
