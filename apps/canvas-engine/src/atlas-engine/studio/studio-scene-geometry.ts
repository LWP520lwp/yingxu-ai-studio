import type {
  CanvasNodeData,
  Position,
  ViewportTransform,
} from "@/types/canvas";

export type StudioViewBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function studioViewBounds(
  view: ViewportTransform,
  size: { width: number; height: number },
  overscan = 500,
): StudioViewBounds {
  return {
    left: (-view.x - overscan) / view.k,
    top: (-view.y - overscan) / view.k,
    right: (size.width - view.x + overscan) / view.k,
    bottom: (size.height - view.y + overscan) / view.k,
  };
}

export function studioPortPosition(
  node: CanvasNodeData,
  side: "source" | "target",
): Position {
  return {
    x: node.position.x + (side === "source" ? node.width : 0),
    y: node.position.y + Math.min(74, node.height / 2),
  };
}

const wireReach = (from: Position, to: Position) =>
  Math.max(64, Math.min(320, Math.abs(to.x - from.x) * 0.55));

export function studioWirePath(from: Position, to: Position) {
  const reach = wireReach(from, to);
  return `M${from.x},${from.y} C${from.x + reach},${from.y} ${to.x - reach},${to.y} ${to.x},${to.y}`;
}

/** A cubic stays inside its control-point hull, including when both nodes are offscreen. */
export function studioWireInBounds(
  from: Position,
  to: Position,
  bounds: StudioViewBounds,
): boolean {
  const reach = wireReach(from, to);
  return (
    Math.max(from.x + reach, to.x) >= bounds.left &&
    Math.min(from.x, to.x - reach) <= bounds.right &&
    Math.max(from.y, to.y) >= bounds.top &&
    Math.min(from.y, to.y) <= bounds.bottom
  );
}
