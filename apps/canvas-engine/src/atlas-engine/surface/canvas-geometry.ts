import { screenToWorld, worldToScreen } from "./geometry";
import {
  routeCanvasConnection,
  routeConnectionPreview,
  type AtlasConnectionBox,
  type AtlasConnectionRoute,
} from "./connection-routing";
import {
  ATLAS_ZOOM_LIMITS,
  clampCanvasZoom,
  panCanvasBy,
  zoomCanvasAt,
} from "./viewport";
import type {
  CanvasNodeData,
  Position,
  ViewportTransform,
} from "@/types/canvas";

export const VIEWPORT_LIMITS = ATLAS_ZOOM_LIMITS;

const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

function safeViewport(viewport: ViewportTransform) {
  return {
    x: finite(viewport.x),
    y: finite(viewport.y),
    k: clampScale(finite(viewport.k, 1)),
  };
}

function atlasViewport(viewport: ViewportTransform) {
  const safe = safeViewport(viewport);
  return { x: safe.x, y: safe.y, scale: safe.k };
}

function connectionBox(node: CanvasNodeData): AtlasConnectionBox {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
  };
}

export function clampScale(scale: number) {
  return clampCanvasZoom(finite(scale, 1));
}

export function worldPoint(
  viewport: ViewportTransform,
  screen: Position,
): Position {
  return screenToWorld(atlasViewport(viewport), {
    x: finite(screen.x),
    y: finite(screen.y),
  });
}

export function screenPoint(
  viewport: ViewportTransform,
  world: Position,
): Position {
  return worldToScreen(atlasViewport(viewport), {
    x: finite(world.x),
    y: finite(world.y),
  });
}

export function panViewport(
  viewport: ViewportTransform,
  dx: number,
  dy: number,
): ViewportTransform {
  return panCanvasBy(safeViewport(viewport), {
    x: finite(dx),
    y: finite(dy),
  });
}

export function zoomViewportAt(
  viewport: ViewportTransform,
  screen: Position,
  wheelDelta: number,
): ViewportTransform {
  const safe = safeViewport(viewport);
  const next = zoomCanvasAt(
    safe,
    { x: finite(screen.x), y: finite(screen.y) },
    Math.pow(1.1, -finite(wheelDelta) / 100),
  );
  return { ...next, k: clampScale(next.k) };
}

export function connectionCurve(
  from: CanvasNodeData,
  to: CanvasNodeData,
): AtlasConnectionRoute {
  return routeCanvasConnection(connectionBox(from), connectionBox(to));
}

export function activeConnectionCurve(
  node: CanvasNodeData,
  handleType: "source" | "target",
  pointer: Position,
  target?: CanvasNodeData,
): AtlasConnectionRoute {
  if (target) {
    const source = handleType === "source" ? node : target;
    const destination = handleType === "source" ? target : node;
    return routeCanvasConnection(
      connectionBox(source),
      connectionBox(destination),
    );
  }
  return routeConnectionPreview(connectionBox(node), handleType, {
    x: finite(pointer.x),
    y: finite(pointer.y),
  });
}
