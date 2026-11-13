import { routeCanvasConnection } from "@/atlas-engine/surface/connection-routing";
import { screenToWorld, worldToScreen } from "@/atlas-engine/surface/geometry";
import { clampCanvasZoom } from "@/atlas-engine/surface/viewport";
import type {
  CanvasConnection,
  CanvasNodeData,
  ViewportTransform,
} from "@/types/canvas";

export type MinimapPoint = { x: number; y: number };
export type MinimapRect = MinimapPoint & { width: number; height: number };
export type MinimapLayout = {
  width: number;
  height: number;
  world: { x: number; y: number; width: number; height: number };
  scale: number;
  offset: MinimapPoint;
};

const DEFAULT_PADDING = 500;

function atlasViewport(viewport: ViewportTransform) {
  return {
    x: finite(viewport.x),
    y: finite(viewport.y),
    scale: clampCanvasZoom(viewport.k),
  };
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function createMinimapLayout(
  nodes: CanvasNodeData[],
  width = 240,
  height = 160,
  padding = DEFAULT_PADDING,
): MinimapLayout {
  const mapWidth = Number.isFinite(width) && width > 0 ? width : 240;
  const mapHeight = Number.isFinite(height) && height > 0 ? height : 160;
  const gutter = Number.isFinite(padding)
    ? Math.max(0, padding)
    : DEFAULT_PADDING;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    if (
      !Number.isFinite(node.position.x) ||
      !Number.isFinite(node.position.y) ||
      !Number.isFinite(node.width) ||
      !Number.isFinite(node.height)
    ) {
      continue;
    }
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + Math.max(0, node.width));
    maxY = Math.max(maxY, node.position.y + Math.max(0, node.height));
  }
  if (!Number.isFinite(minX)) {
    minX = -gutter;
    minY = -gutter;
    maxX = gutter;
    maxY = gutter;
  } else {
    minX -= gutter;
    minY -= gutter;
    maxX += gutter;
    maxY += gutter;
  }
  let worldWidth = maxX - minX;
  let worldHeight = maxY - minY;
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(worldWidth) ||
    !Number.isFinite(worldHeight)
  ) {
    minX = -gutter;
    minY = -gutter;
    worldWidth = gutter * 2 || 1;
    worldHeight = gutter * 2 || 1;
  }
  worldWidth = Math.max(1, worldWidth);
  worldHeight = Math.max(1, worldHeight);
  const scale = Math.min(mapWidth / worldWidth, mapHeight / worldHeight);
  const contentWidth = worldWidth * scale;
  const contentHeight = worldHeight * scale;

  return {
    width: mapWidth,
    height: mapHeight,
    world: { x: minX, y: minY, width: worldWidth, height: worldHeight },
    scale,
    offset: {
      x: (mapWidth - contentWidth) / 2,
      y: (mapHeight - contentHeight) / 2,
    },
  };
}

export function worldToMinimap(point: MinimapPoint, layout: MinimapLayout) {
  return {
    x: (finite(point.x) - layout.world.x) * layout.scale + layout.offset.x,
    y: (finite(point.y) - layout.world.y) * layout.scale + layout.offset.y,
  };
}

export function minimapToWorld(point: MinimapPoint, layout: MinimapLayout) {
  const scale =
    layout.scale > 0 && Number.isFinite(layout.scale) ? layout.scale : 1;
  return {
    x: (finite(point.x) - layout.offset.x) / scale + layout.world.x,
    y: (finite(point.y) - layout.offset.y) / scale + layout.world.y,
  };
}

export function minimapNodeRect(
  node: CanvasNodeData,
  layout: MinimapLayout,
): MinimapRect {
  const origin = worldToMinimap(node.position, layout);
  return {
    ...origin,
    width: Math.max(2, Math.max(0, finite(node.width)) * layout.scale),
    height: Math.max(2, Math.max(0, finite(node.height)) * layout.scale),
  };
}

export function minimapConnectionPath(
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
  layout: MinimapLayout,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const segments: string[] = [];
  for (const connection of connections) {
    const from = nodeById.get(connection.fromNodeId);
    const to = nodeById.get(connection.toNodeId);
    if (!from || !to) continue;
    if (
      ![
        from.position.x,
        from.position.y,
        from.width,
        from.height,
        to.position.x,
        to.position.y,
        to.width,
        to.height,
      ].every(Number.isFinite)
    ) {
      continue;
    }
    const curve = routeCanvasConnection(
      {
        x: from.position.x,
        y: from.position.y,
        width: from.width,
        height: from.height,
      },
      {
        x: to.position.x,
        y: to.position.y,
        width: to.width,
        height: to.height,
      },
    );
    if (
      ![
        curve.start.x,
        curve.start.y,
        curve.control1.x,
        curve.control1.y,
        curve.control2.x,
        curve.control2.y,
        curve.end.x,
        curve.end.y,
      ].every(Number.isFinite)
    ) {
      continue;
    }
    const start = worldToMinimap(curve.start, layout);
    const control1 = worldToMinimap(curve.control1, layout);
    const control2 = worldToMinimap(curve.control2, layout);
    const end = worldToMinimap(curve.end, layout);
    segments.push(
      `M${start.x} ${start.y}C${control1.x} ${control1.y},${control2.x} ${control2.y},${end.x} ${end.y}`,
    );
  }
  return segments.join("");
}

export function minimapViewportRect(
  viewport: ViewportTransform,
  viewportSize: { width: number; height: number },
  layout: MinimapLayout,
): MinimapRect {
  const transform = atlasViewport(viewport);
  const origin = worldToMinimap(
    screenToWorld(transform, { x: 0, y: 0 }),
    layout,
  );
  const end = worldToMinimap(
    screenToWorld(transform, {
      x: Math.max(0, finite(viewportSize.width)),
      y: Math.max(0, finite(viewportSize.height)),
    }),
    layout,
  );
  return {
    ...origin,
    width: Math.max(end.x - origin.x, 4),
    height: Math.max(end.y - origin.y, 4),
  };
}

export function viewportAtMinimapPoint(
  point: MinimapPoint,
  viewport: ViewportTransform,
  viewportSize: { width: number; height: number },
  layout: MinimapLayout,
): ViewportTransform {
  const scale = clampCanvasZoom(viewport.k);
  const world = minimapToWorld(point, layout);
  const scaledWorldPoint = worldToScreen({ x: 0, y: 0, scale }, world);
  return {
    x: Math.max(0, finite(viewportSize.width)) / 2 - scaledWorldPoint.x,
    y: Math.max(0, finite(viewportSize.height)) / 2 - scaledWorldPoint.y,
    k: scale,
  };
}
