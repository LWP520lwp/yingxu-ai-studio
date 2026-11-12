import { clampScale } from "@/lib/canvas/canvas-geometry";
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
    const start = worldToMinimap(
      {
        x: from.position.x + from.width / 2,
        y: from.position.y + from.height / 2,
      },
      layout,
    );
    const end = worldToMinimap(
      { x: to.position.x + to.width / 2, y: to.position.y + to.height / 2 },
      layout,
    );
    segments.push(`M${start.x} ${start.y}L${end.x} ${end.y}`);
  }
  return segments.join("");
}

export function minimapViewportRect(
  viewport: ViewportTransform,
  viewportSize: { width: number; height: number },
  layout: MinimapLayout,
): MinimapRect {
  const scale = clampScale(viewport.k);
  const origin = worldToMinimap(
    {
      x: -finite(viewport.x) / scale,
      y: -finite(viewport.y) / scale,
    },
    layout,
  );
  const end = worldToMinimap(
    {
      x:
        -finite(viewport.x) / scale +
        Math.max(0, finite(viewportSize.width)) / scale,
      y:
        -finite(viewport.y) / scale +
        Math.max(0, finite(viewportSize.height)) / scale,
    },
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
  const scale = clampScale(viewport.k);
  const world = minimapToWorld(point, layout);
  return {
    x: Math.max(0, finite(viewportSize.width)) / 2 - world.x * scale,
    y: Math.max(0, finite(viewportSize.height)) / 2 - world.y * scale,
    k: scale,
  };
}
