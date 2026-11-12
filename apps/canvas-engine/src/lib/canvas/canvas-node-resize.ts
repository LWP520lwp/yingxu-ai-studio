export type ResizeCorner =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type CanvasNodeResizeInput = {
  corner: ResizeCorner;
  pointerStart: { x: number; y: number };
  pointerNow: { x: number; y: number };
  position: { x: number; y: number };
  size: { width: number; height: number };
  scale: number;
  keepRatio: boolean;
  ratio?: number;
};

export type CanvasNodeResizeResult = {
  position: { x: number; y: number };
  width: number;
  height: number;
};

const MIN_WIDTH = 220;
const MIN_HEIGHT = 160;
const MAX_DIMENSION = 1_000_000;

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function bounded(value: number, minimum: number) {
  return Math.max(minimum, Math.min(MAX_DIMENSION, finite(value, minimum)));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

/** Compute a resize while keeping the opposite corner fixed. */
export function resizeCanvasNode(
  input: CanvasNodeResizeInput,
): CanvasNodeResizeResult {
  const startX = finite(input.pointerStart.x, 0);
  const startY = finite(input.pointerStart.y, 0);
  const pointerX = finite(input.pointerNow.x, startX);
  const pointerY = finite(input.pointerNow.y, startY);
  const scale =
    Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1;
  const left = finite(input.position.x, 0);
  const top = finite(input.position.y, 0);
  const startWidth = bounded(input.size.width, MIN_WIDTH);
  const startHeight = bounded(input.size.height, MIN_HEIGHT);
  const dx = (pointerX - startX) / scale;
  const dy = (pointerY - startY) / scale;
  const fromLeft = input.corner.includes("left");
  const fromTop = input.corner.includes("top");
  const fixedRight = left + startWidth;
  const fixedBottom = top + startHeight;

  let width = bounded(startWidth + (fromLeft ? -dx : dx), MIN_WIDTH);
  let height = bounded(startHeight + (fromTop ? -dy : dy), MIN_HEIGHT);

  if (input.keepRatio) {
    const requestedRatio = input.ratio;
    const ratio =
      Number.isFinite(requestedRatio) && requestedRatio! > 0
        ? clamp(
            requestedRatio!,
            MIN_WIDTH / MAX_DIMENSION,
            MAX_DIMENSION / MIN_HEIGHT,
          )
        : startWidth / startHeight;
    const widthFromPointer =
      Math.abs(dx) >= Math.abs(dy) ? width : height * ratio;
    const minimumWidth = Math.max(MIN_WIDTH, MIN_HEIGHT * ratio);
    const maximumWidth = Math.min(MAX_DIMENSION, MAX_DIMENSION * ratio);
    width = clamp(widthFromPointer, minimumWidth, maximumWidth);
    height = bounded(width / ratio, MIN_HEIGHT);
  }

  return {
    width,
    height,
    position: {
      x: fromLeft ? finite(fixedRight - width, left) : left,
      y: fromTop ? finite(fixedBottom - height, top) : top,
    },
  };
}
