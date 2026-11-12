export type ImageEditorSize = { width: number; height: number };
export type ImageEditorPoint = { x: number; y: number };
export type ImageEditorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type ImageEditorZoomAnchor = {
  zoom: number;
  ratioX: number;
  ratioY: number;
  viewportX: number;
  viewportY: number;
};
export type ImageEditorPanState = {
  pointerX: number;
  pointerY: number;
  scrollLeft: number;
  scrollTop: number;
};

export type ImageEditorLayout = {
  stageSize: ImageEditorSize;
  contentSize: ImageEditorSize;
  stageOffset: ImageEditorPoint;
};

export const IMAGE_EDITOR_MIN_ZOOM = 1;
export const IMAGE_EDITOR_MAX_ZOOM = 4;
export const IMAGE_EDITOR_VIEWPORT_PADDING = 16;
const MAX_IMAGE_DIMENSION = 100_000;

export function normalizeImageEditorSize(
  size: ImageEditorSize | null | undefined,
): ImageEditorSize {
  if (!size) return { width: 0, height: 0 };
  return {
    width: normalizedDimension(size.width),
    height: normalizedDimension(size.height),
  };
}

function normalizedDimension(value: number) {
  return Number.isFinite(value) && value > 0
    ? Math.min(MAX_IMAGE_DIMENSION, value)
    : 0;
}

export function fitImageToEditorViewport(
  imageInput: ImageEditorSize | null,
  viewportInput: ImageEditorSize,
  padding = IMAGE_EDITOR_VIEWPORT_PADDING,
): ImageEditorSize {
  const image = normalizeImageEditorSize(imageInput);
  const viewport = normalizeImageEditorSize(viewportInput);
  if (!image.width || !image.height || !viewport.width || !viewport.height) {
    return { width: 0, height: 0 };
  }

  const inset = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const availableWidth = Math.max(1, viewport.width - inset * 2);
  const availableHeight = Math.max(1, viewport.height - inset * 2);
  const scale = Math.min(
    availableWidth / image.width,
    availableHeight / image.height,
    1,
  );
  return {
    width: Math.max(1, Math.floor(image.width * scale)),
    height: Math.max(1, Math.floor(image.height * scale)),
  };
}

export function clampImageEditorZoom(value: number) {
  if (!Number.isFinite(value)) return IMAGE_EDITOR_MIN_ZOOM;
  return Math.min(
    IMAGE_EDITOR_MAX_ZOOM,
    Math.max(IMAGE_EDITOR_MIN_ZOOM, value),
  );
}

export function imageEditorLayout(
  baseSizeInput: ImageEditorSize,
  viewportInput: ImageEditorSize,
  zoomInput: number,
): ImageEditorLayout {
  const baseSize = normalizeImageEditorSize(baseSizeInput);
  const viewport = normalizeImageEditorSize(viewportInput);
  const zoom = clampImageEditorZoom(zoomInput);
  const stageSize = {
    width: baseSize.width * zoom,
    height: baseSize.height * zoom,
  };
  const contentSize = {
    width: Math.max(viewport.width, stageSize.width),
    height: Math.max(viewport.height, stageSize.height),
  };
  return {
    stageSize,
    contentSize,
    stageOffset: {
      x: Math.max(0, Math.round((contentSize.width - stageSize.width) / 2)),
      y: Math.max(0, Math.round((contentSize.height - stageSize.height) / 2)),
    },
  };
}

export function zoomAnchorAtPoint(input: {
  baseSize: ImageEditorSize;
  viewport: ImageEditorRect;
  scroll: ImageEditorPoint;
  currentZoom: number;
  nextZoom: number;
  clientPoint?: ImageEditorPoint;
  previousAnchor?: ImageEditorZoomAnchor | null;
}): ImageEditorZoomAnchor | null {
  const baseSize = normalizeImageEditorSize(input.baseSize);
  const viewportSize = normalizeImageEditorSize({
    width: input.viewport.width,
    height: input.viewport.height,
  });
  if (
    !baseSize.width ||
    !baseSize.height ||
    !viewportSize.width ||
    !viewportSize.height
  ) {
    return null;
  }

  const zoom = clampImageEditorZoom(input.nextZoom);
  const currentZoom = clampImageEditorZoom(input.currentZoom);
  if (Math.abs(zoom - currentZoom) < 0.001) return null;

  const point = input.clientPoint || {
    x: input.viewport.left + input.viewport.width / 2,
    y: input.viewport.top + input.viewport.height / 2,
  };
  const pointerX = finite(
    point.x,
    input.viewport.left + input.viewport.width / 2,
  );
  const pointerY = finite(
    point.y,
    input.viewport.top + input.viewport.height / 2,
  );
  const viewportX = pointerX - input.viewport.left;
  const viewportY = pointerY - input.viewport.top;
  const previous = input.previousAnchor;

  // If React has not committed the prior wheel event yet, derive its effective
  // scroll from that pending anchor so rapid zoom events compose correctly.
  const currentLayout = imageEditorLayout(baseSize, viewportSize, currentZoom);
  const scroll =
    previous && Math.abs(previous.zoom - currentZoom) < 0.001
      ? {
          x:
            currentLayout.stageOffset.x +
            previous.ratioX * currentLayout.stageSize.width -
            previous.viewportX,
          y:
            currentLayout.stageOffset.y +
            previous.ratioY * currentLayout.stageSize.height -
            previous.viewportY,
        }
      : input.scroll;
  const stageLeft =
    input.viewport.left + currentLayout.stageOffset.x - finite(scroll.x, 0);
  const stageTop =
    input.viewport.top + currentLayout.stageOffset.y - finite(scroll.y, 0);
  const ratioX = (pointerX - stageLeft) / currentLayout.stageSize.width;
  const ratioY = (pointerY - stageTop) / currentLayout.stageSize.height;

  return {
    zoom,
    ratioX: clamp(finite(ratioX, 0.5), 0, 1),
    ratioY: clamp(finite(ratioY, 0.5), 0, 1),
    viewportX,
    viewportY,
  };
}

export function scrollForZoomAnchor(
  anchor: ImageEditorZoomAnchor,
  baseSize: ImageEditorSize,
  viewportSize: ImageEditorSize,
) {
  const layout = imageEditorLayout(baseSize, viewportSize, anchor.zoom);
  return {
    left:
      layout.stageOffset.x +
      anchor.ratioX * layout.stageSize.width -
      anchor.viewportX,
    top:
      layout.stageOffset.y +
      anchor.ratioY * layout.stageSize.height -
      anchor.viewportY,
  };
}

export function imageEditorPanScroll(
  pan: ImageEditorPanState,
  pointer: ImageEditorPoint,
) {
  return {
    left: Math.max(
      0,
      pan.scrollLeft - (finite(pointer.x, pan.pointerX) - pan.pointerX),
    ),
    top: Math.max(
      0,
      pan.scrollTop - (finite(pointer.y, pan.pointerY) - pan.pointerY),
    ),
  };
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
