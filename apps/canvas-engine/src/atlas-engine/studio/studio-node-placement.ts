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
  const centered = (w: number) =>
    Math.max(margin, Math.min(size.width - w - margin, (left + right - w) / 2));
  const x = centered(width);
  const above = top - gap - barHeight;
  const y =
    above >= margin
      ? above
      : Math.min(size.height - barHeight - margin, bottom + gap);
  const dockClearance = 76;
  const limit = Math.max(margin, size.height - dockClearance - margin);
  const barAbove = above >= margin;
  // The composer is anchored to the node edge, independently of the toolbar.
  const belowStart = barAbove ? bottom + gap : y + barHeight + gap;
  const aboveEnd = barAbove ? y - gap : top - gap;
  const belowRoom = Math.max(0, limit - belowStart);
  const aboveRoom = Math.max(0, aboveEnd - margin);
  const panelBelow = belowRoom >= 300 || belowRoom >= aboveRoom;
  const panelHeight = Math.min(344, panelBelow ? belowRoom : aboveRoom);
  const panelWidth = Math.min(680, Math.max(0, size.width - margin * 2));
  return {
    x,
    y: Math.max(margin, y),
    width,
    panelX: centered(panelWidth),
    panelY: panelBelow ? belowStart : aboveEnd - panelHeight,
    panelWidth,
    panelBelow,
    panelHeight,
  };
}

/** Make room once when opening the editor; subsequent panning remains user controlled. */
export function studioNodeEditingView(
  node: CanvasNodeData,
  view: ViewportTransform,
  size: { width: number; height: number },
): ViewportTransform {
  const place = studioNodePlacement(node, view, size);
  if (place && place.panelHeight >= 300) return view;
  const top = 68;
  const room = Math.max(32, size.height - 76 - 12 - 300 - 12 - top);
  const k = Math.max(
    0.12,
    Math.min(
      view.k,
      room / node.height,
      Math.max(1, size.width - 48) / node.width,
    ),
  );
  return {
    k,
    x: size.width / 2 - (node.position.x + node.width / 2) * k,
    y: top - node.position.y * k,
  };
}
