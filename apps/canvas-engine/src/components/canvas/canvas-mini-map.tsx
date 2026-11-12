import { useCallback, useMemo, useRef, useState } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import {
  createMinimapLayout,
  minimapConnectionPath,
  minimapNodeRect,
  minimapViewportRect,
  viewportAtMinimapPoint,
} from "@/lib/canvas/canvas-minimap";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import type {
  CanvasConnection,
  CanvasNodeData,
  ViewportTransform,
} from "@/types/canvas";

const MINIMAP_WIDTH = 240;
const MINIMAP_HEIGHT = 160;

type MinimapProps = {
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  viewport: ViewportTransform;
  viewportSize: { width: number; height: number };
  onViewportChange: (viewport: ViewportTransform) => void;
};

export function Minimap({
  nodes,
  connections,
  viewport,
  viewportSize,
  onViewportChange,
}: MinimapProps) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const layout = useMemo(
    () => createMinimapLayout(nodes, MINIMAP_WIDTH, MINIMAP_HEIGHT),
    [nodes],
  );
  const connectionPath = useMemo(
    () => minimapConnectionPath(nodes, connections, layout),
    [connections, layout, nodes],
  );
  const nodeRects = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        rect: minimapNodeRect(node, layout),
        color: getNodeDefinition(node.type)?.minimapColor || theme.node.muted,
      })),
    [layout, nodes, theme.node.muted],
  );
  const viewportRect = useMemo(
    () => minimapViewportRect(viewport, viewportSize, layout),
    [layout, viewport, viewportSize],
  );

  const updateViewportFromEvent = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const x = ((event.clientX - rect.left) / rect.width) * MINIMAP_WIDTH;
      const y = ((event.clientY - rect.top) / rect.height) * MINIMAP_HEIGHT;
      onViewportChange(
        viewportAtMinimapPoint({ x, y }, viewport, viewportSize, layout),
      );
    },
    [layout, onViewportChange, viewport, viewportSize],
  );

  return (
    <div
      className="absolute bottom-24 left-6 z-50 overflow-hidden rounded-lg border shadow-2xl backdrop-blur-sm"
      style={{
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
      }}
    >
      <div
        ref={containerRef}
        className="relative h-full w-full cursor-crosshair"
        role="group"
        tabIndex={0}
        aria-label="画布小地图，拖动或使用方向键移动视口"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsDragging(true);
          updateViewportFromEvent(event);
        }}
        onPointerMove={(event) => {
          if (isDragging) updateViewportFromEvent(event);
        }}
        onPointerUp={() => setIsDragging(false)}
        onPointerCancel={() => setIsDragging(false)}
        onLostPointerCapture={() => setIsDragging(false)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 120 : 48;
          const offsets: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const offset = offsets[event.key];
          if (!offset) return;
          event.preventDefault();
          onViewportChange({
            ...viewport,
            x: viewport.x + offset[0],
            y: viewport.y + offset[1],
          });
        }}
      >
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
          aria-hidden="true"
        >
          <path
            d={connectionPath}
            fill="none"
            stroke={theme.node.muted}
            strokeOpacity={0.42}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {nodeRects.map(({ id, rect, color }) => (
            <rect
              key={id}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={1}
              fill={color}
              opacity={0.82}
            />
          ))}
          <rect
            x={viewportRect.x}
            y={viewportRect.y}
            width={viewportRect.width}
            height={viewportRect.height}
            fill={`${theme.node.activeStroke}18`}
            stroke={theme.node.activeStroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}
