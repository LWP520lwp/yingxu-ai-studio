import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import {
  createMinimapLayout,
  minimapConnectionPath,
  minimapNodeRect,
  minimapViewportRect,
  viewportAtMinimapPoint,
} from "@/atlas-engine/ui/canvas-minimap";
import { getAtlasNodeDefinition as getNodeDefinition } from "@/atlas-engine/model/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import type {
  CanvasConnection,
  CanvasNodeData,
  ViewportTransform,
} from "@/types/canvas";

const MAP_SIZE = { width: 240, height: 160 } as const;
const KEYBOARD_NUDGE = 48;

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
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const surfaceRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const layout = useMemo(
    () => createMinimapLayout(nodes, MAP_SIZE.width, MAP_SIZE.height),
    [nodes],
  );
  const links = useMemo(
    () => minimapConnectionPath(nodes, connections, layout),
    [connections, layout, nodes],
  );
  const shapes = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        bounds: minimapNodeRect(node, layout),
        color: getNodeDefinition(node.type)?.minimapColor ?? theme.node.muted,
      })),
    [layout, nodes, theme.node.muted],
  );
  const frame = useMemo(
    () => minimapViewportRect(viewport, viewportSize, layout),
    [layout, viewport, viewportSize],
  );

  const pointFromPointer = useCallback((event: React.PointerEvent) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x = ((event.clientX - rect.left) / rect.width) * MAP_SIZE.width;
    const y = ((event.clientY - rect.top) / rect.height) * MAP_SIZE.height;
    return { x, y };
  }, []);

  const centerAt = useCallback(
    (x: number, y: number) => {
      onViewportChange(
        viewportAtMinimapPoint({ x, y }, viewport, viewportSize, layout),
      );
    },
    [layout, onViewportChange, viewport, viewportSize],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      const point = pointFromPointer(event);
      if (point) centerAt(point.x, point.y);
    },
    [centerAt, pointFromPointer],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const point = pointFromPointer(event);
      if (point) centerAt(point.x, point.y);
    },
    [centerAt, pointFromPointer],
  );

  const finishDrag = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const movement: Record<string, [number, number]> = {
        ArrowLeft: [-KEYBOARD_NUDGE, 0],
        ArrowRight: [KEYBOARD_NUDGE, 0],
        ArrowUp: [0, -KEYBOARD_NUDGE],
        ArrowDown: [0, KEYBOARD_NUDGE],
      };
      const [dx, dy] = movement[event.key] ?? [0, 0];
      if (!dx && !dy) return;
      event.preventDefault();
      const currentCenter = {
        x: frame.x + frame.width / 2,
        y: frame.y + frame.height / 2,
      };
      const multiplier = event.shiftKey ? 3 : 1;
      centerAt(
        currentCenter.x + dx * multiplier * layout.scale,
        currentCenter.y + dy * multiplier * layout.scale,
      );
    },
    [centerAt, frame, layout.scale],
  );

  return (
    <section
      className="absolute bottom-24 left-6 z-50 overflow-hidden rounded-lg border shadow-2xl backdrop-blur-sm"
      style={{
        width: MAP_SIZE.width,
        height: MAP_SIZE.height,
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
      }}
      aria-label={t("canvas.miniMapLabel")}
    >
      <div
        ref={surfaceRef}
        className="relative h-full w-full cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset"
        role="application"
        tabIndex={0}
        aria-label={`${t("canvas.miniMapLabel")}. ${t("canvas.miniMapHint")}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onKeyDown={handleKeyDown}
      >
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`}
          aria-hidden="true"
        >
          <path
            d={links}
            fill="none"
            stroke={theme.node.muted}
            strokeOpacity={0.42}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {shapes.map(({ id, bounds, color }) => (
            <rect
              key={id}
              x={bounds.x}
              y={bounds.y}
              width={bounds.width}
              height={bounds.height}
              rx={1}
              fill={color}
              opacity={0.82}
            />
          ))}
          <rect
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            fill={`${theme.node.activeStroke}18`}
            stroke={theme.node.activeStroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </section>
  );
}
