export type AudioPopoverPlacement =
  "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";

export type AudioPopoverAnchor = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
};

export type AudioPopoverViewport = { width: number; height: number };

export type AudioPopoverPosition = {
  width: number;
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

const PREFERRED_WIDTH = 356;
const EDGE_GUTTER = 12;
const ANCHOR_GAP = 8;
const MIN_USEFUL_HEIGHT = 220;

export function positionAudioSettingsPopover(
  anchor: AudioPopoverAnchor,
  viewport: AudioPopoverViewport,
  placement: AudioPopoverPlacement,
): AudioPopoverPosition {
  const viewportWidth = safeDimension(viewport.width);
  const viewportHeight = safeDimension(viewport.height);
  const horizontalGutter = Math.min(
    EDGE_GUTTER,
    Math.max(0, (viewportWidth - 1) / 2),
  );
  const verticalGutter = Math.min(
    EDGE_GUTTER,
    Math.max(0, (viewportHeight - 1) / 2),
  );
  const width = Math.min(
    PREFERRED_WIDTH,
    Math.max(1, viewportWidth - horizontalGutter * 2),
  );
  const safeTop = clamp(
    anchor.top,
    verticalGutter,
    Math.max(verticalGutter, viewportHeight - verticalGutter),
  );
  const safeBottom = clamp(
    anchor.bottom,
    verticalGutter,
    Math.max(verticalGutter, viewportHeight - verticalGutter),
  );
  const requestedTop = placement.startsWith("top");
  const availableAbove = Math.max(1, safeTop - ANCHOR_GAP - verticalGutter);
  const availableBelow = Math.max(
    1,
    viewportHeight - safeBottom - ANCHOR_GAP - verticalGutter,
  );
  const placeAbove = requestedTop
    ? availableAbove >= MIN_USEFUL_HEIGHT || availableAbove >= availableBelow
    : availableBelow < MIN_USEFUL_HEIGHT && availableAbove > availableBelow;
  const alignment = placement.endsWith("Right")
    ? anchor.right - width
    : placement === "top" || placement === "bottom"
      ? anchor.left + anchor.width / 2 - width / 2
      : anchor.left;
  const maxLeft = Math.max(
    horizontalGutter,
    viewportWidth - horizontalGutter - width,
  );
  const left = clamp(alignment, horizontalGutter, maxLeft);
  const maxTop = Math.max(verticalGutter, viewportHeight - verticalGutter - 1);

  return placeAbove
    ? {
        width,
        left,
        bottom: clamp(
          viewportHeight - safeTop + ANCHOR_GAP,
          verticalGutter,
          maxTop,
        ),
        maxHeight: availableAbove,
      }
    : {
        width,
        left,
        top: clamp(safeBottom + ANCHOR_GAP, verticalGutter, maxTop),
        maxHeight: availableBelow,
      };
}

function safeDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

function clamp(value: number, min: number, max: number): number {
  const finiteValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, finiteValue));
}
