type ScreenRect = { left: number; top: number; right: number; bottom: number };

/** Place a counter-scaled panel in screen pixels, reserving the canvas dock. */
export function fitCanvasPanel({ node, viewport, panelWidth, panelHeight, bottomInset = 0, padding = 12, gap = 16 }: {
    node: ScreenRect;
    viewport: ScreenRect;
    panelWidth: number;
    panelHeight: number;
    bottomInset?: number;
    padding?: number;
    gap?: number;
}) {
    const leftBound = viewport.left + padding;
    const topBound = viewport.top + padding;
    const rightBound = Math.max(leftBound + 1, viewport.right - padding);
    const bottomBound = Math.max(topBound + 1, viewport.bottom - Math.max(0, bottomInset) - padding);
    const width = Math.min(Math.max(1, panelWidth), rightBound - leftBound);
    const maxHeight = bottomBound - topBound;
    const height = Math.min(Math.max(1, panelHeight), maxHeight);
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const left = clamp((node.left + node.right - width) / 2, leftBound, rightBound - width);
    const below = node.bottom + gap;
    const above = node.top - gap - height;
    const preferredTop = below + height > bottomBound && above >= topBound ? above : below;
    return { left, top: clamp(preferredTop, topBound, bottomBound - height), width, maxHeight };
}
