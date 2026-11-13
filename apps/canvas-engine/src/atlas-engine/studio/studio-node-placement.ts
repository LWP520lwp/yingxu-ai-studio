import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

/** Overlay geometry uses screen pixels so controls stay legible at any canvas zoom. */
export function studioNodePlacement(
  node: CanvasNodeData,
  view: ViewportTransform,
  size: { width: number; height: number },
) {
  const margin = 12,
    gap = 12,
    barHeight = 44;
  const left = node.position.x * view.k + view.x;
  const top = node.position.y * view.k + view.y;
  const right = left + node.width * view.k;
  const bottom = top + node.height * view.k;
  if (right < 0 || left > size.width || bottom < 0 || top > size.height)
    return null;
  const width = Math.min(354, Math.max(0, size.width - margin * 2));
  const x = Math.max(
    margin,
    Math.min(size.width - width - margin, (left + right - width) / 2),
  );
  const above = top - gap - barHeight;
  const y =
    above >= margin
      ? above
      : Math.min(size.height - barHeight - margin, bottom + gap);
  // The bottom dock remains clickable while the node composer is open.
  const dockClearance = 76;
  const belowRoom = size.height - dockClearance - y - barHeight - gap - margin;
  const aboveRoom = y - gap - margin;
  const panelBelow = belowRoom >= Math.min(300, aboveRoom);
  return {
    x,
    y: Math.max(margin, y),
    width,
    panelBelow,
    panelHeight: Math.max(0, Math.min(430, panelBelow ? belowRoom : aboveRoom)),
  };
}
