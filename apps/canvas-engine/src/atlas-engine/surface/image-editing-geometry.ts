export type AtlasCropRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
export type AtlasImageSize = Readonly<{ width: number; height: number }>;
export type AtlasCropHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
export type AtlasPixelRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type AtlasEditorPoint = Readonly<{ x: number; y: number }>;
export type AtlasEditorRect = Readonly<{ left: number; top: number; width: number; height: number }>;
export type AtlasEditorZoomAnchor = Readonly<{
  zoom: number;
  ratioX: number;
  ratioY: number;
  viewportX: number;
  viewportY: number;
}>;
export type AtlasEditorPanState = Readonly<{
  pointerX: number;
  pointerY: number;
  scrollLeft: number;
  scrollTop: number;
}>;
export type AtlasEditorLayout = Readonly<{
  stageSize: AtlasImageSize;
  contentSize: AtlasImageSize;
  stageOffset: AtlasEditorPoint;
}>;

export const ATLAS_DEFAULT_CROP: AtlasCropRect = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };
export const ATLAS_CROP_HANDLES: readonly AtlasCropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const ATLAS_CROP_MIN_EDGE = 0.06;
export const ATLAS_MAX_SPLIT_MARKS = 11;
export const ATLAS_EDITOR_ZOOM = { min: 1, max: 4 } as const;
export const ATLAS_EDITOR_PADDING = 16;

const MAX_SAFE_MEDIA_EDGE = 100_000;

function numberOr(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function bounded(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, numberOr(value, min)));
}

function mediaDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, MAX_SAFE_MEDIA_EDGE) : 0;
}

function integerExtent(value: number): number {
  return Math.max(1, Math.floor(numberOr(value, 1)));
}

export function moveAtlasCrop(rect: AtlasCropRect, dx: number, dy: number): AtlasCropRect {
  const maxX = Math.max(0, 1 - rect.width);
  const maxY = Math.max(0, 1 - rect.height);
  return {
    ...rect,
    x: bounded(rect.x + numberOr(dx), 0, maxX),
    y: bounded(rect.y + numberOr(dy), 0, maxY),
  };
}

export function resizeAtlasCrop(
  rect: AtlasCropRect,
  dx: number,
  dy: number,
  handle: AtlasCropHandle,
  aspectRatio: number | null,
  stage: AtlasImageSize,
): AtlasCropRect {
  const deltaX = numberOr(dx);
  const deltaY = numberOr(dy);
  const stageWidth = Math.max(1, numberOr(stage.width, 1));
  const stageHeight = Math.max(1, numberOr(stage.height, 1));
  const horizontal = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const vertical = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  let width = rect.width + horizontal * deltaX;
  let height = rect.height + vertical * deltaY;
  let nextWidth: number;
  let nextHeight: number;

  if (Number.isFinite(aspectRatio) && aspectRatio !== null && aspectRatio > 0) {
    const normalizedRatio = aspectRatio * (stageHeight / stageWidth);
    const onlyHorizontal = horizontal !== 0 && vertical === 0;
    const chooseWidth = onlyHorizontal || (horizontal !== 0 && vertical !== 0 && Math.abs(deltaX * stageWidth) >= Math.abs(deltaY * stageHeight));
    const requestedHeight = chooseWidth ? width / normalizedRatio : height;
    const maximumHeight = Math.min(1, 1 / normalizedRatio);
    const minimumHeight = Math.min(maximumHeight, ATLAS_CROP_MIN_EDGE / Math.min(1, normalizedRatio));
    nextHeight = bounded(requestedHeight, minimumHeight, maximumHeight);
    nextWidth = nextHeight * normalizedRatio;
  } else {
    nextWidth = bounded(width, ATLAS_CROP_MIN_EDGE, 1);
    nextHeight = bounded(height, ATLAS_CROP_MIN_EDGE, 1);
  }

  const maxX = 1 - nextWidth;
  const maxY = 1 - nextHeight;
  return {
    x: bounded(horizontal < 0 ? rect.x + rect.width - nextWidth : rect.x, 0, maxX),
    y: bounded(vertical < 0 ? rect.y + rect.height - nextHeight : rect.y, 0, maxY),
    width: nextWidth,
    height: nextHeight,
  };
}

export function resolveAtlasCropRatio(preset: string, image: AtlasImageSize | null, fixedRatio: number | null): number | null {
  if (preset === "free" || !image) return null;
  if (preset === "fixed") return fixedRatio;
  if (preset === "original") return image.height > 0 ? image.width / image.height : null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(preset);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

export function fitAtlasCropRatio(rect: AtlasCropRect, aspectRatio: number, image: AtlasImageSize): AtlasCropRect {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0 || image.width <= 0 || image.height <= 0) return rect;
  const ratioInUnitSpace = aspectRatio * (image.height / image.width);
  const maxWidth = bounded(rect.width, 0, 1);
  const maxHeight = bounded(rect.height, 0, 1);
  let width = maxWidth;
  let height = width / ratioInUnitSpace;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratioInUnitSpace;
  }
  width = Math.min(width, 1);
  height = Math.min(height, 1);
  return {
    x: bounded(rect.x + (rect.width - width) / 2, 0, 1 - width),
    y: bounded(rect.y + (rect.height - height) / 2, 0, 1 - height),
    width,
    height,
  };
}

export function nudgeAtlasCrop(rect: AtlasCropRect, direction: "up" | "down" | "left" | "right", coarse = false): AtlasCropRect {
  const delta = coarse ? 0.05 : 0.01;
  const vector: Record<typeof direction, AtlasEditorPoint> = {
    up: { x: 0, y: -delta },
    down: { x: 0, y: delta },
    left: { x: -delta, y: 0 },
    right: { x: delta, y: 0 },
  };
  const offset = vector[direction];
  return moveAtlasCrop(rect, offset.x, offset.y);
}

export function atlasCropRatio(width: number, height: number): string {
  let a = Math.max(1, Math.round(numberOr(width)));
  let b = Math.max(1, Math.round(numberOr(height)));
  while (b !== 0) [a, b] = [b, a % b];
  return `${Math.max(1, Math.round(numberOr(width))) / a}:${Math.max(1, Math.round(numberOr(height))) / a}`;
}

export function atlasCropHandleStyle(handle: AtlasCropHandle) {
  const edge = "-12px";
  const middle = "calc(50% - 12px)";
  return {
    top: handle.includes("n") ? edge : handle.includes("s") ? "calc(100% - 12px)" : middle,
    left: handle.includes("w") ? edge : handle.includes("e") ? "calc(100% - 12px)" : middle,
    cursor: `${handle}-resize`,
  };
}

export function normalizeAtlasCropPixels(rect: AtlasPixelRect, source: AtlasImageSize): AtlasPixelRect {
  const width = integerExtent(source.width);
  const height = integerExtent(source.height);
  const x = bounded(Math.floor(numberOr(rect.x)), 0, width - 1);
  const y = bounded(Math.floor(numberOr(rect.y)), 0, height - 1);
  return {
    x,
    y,
    width: Math.min(width - x, Math.max(1, Math.ceil(numberOr(rect.width, width)))),
    height: Math.min(height - y, Math.max(1, Math.ceil(numberOr(rect.height, height)))),
  };
}

export function normalizeAtlasSplitMarks(marks: number[] | undefined, size: number, requestedCount: number): number[] {
  const extent = integerExtent(size);
  const pieces = Math.min(extent, ATLAS_MAX_SPLIT_MARKS + 1, integerExtent(requestedCount));
  if (!Array.isArray(marks) || marks.length === 0) {
    return Array.from({ length: pieces + 1 }, (_, index) => Math.floor(index * extent / pieces));
  }
  const inner = [...new Set(marks.map((mark) => Math.round(numberOr(mark, -1) * extent)).filter((mark) => mark > 0 && mark < extent))]
    .sort((left, right) => left - right)
    .slice(0, ATLAS_MAX_SPLIT_MARKS);
  return [0, ...inner, extent];
}

export function atlasUpscaleDimensions(width: number, height: number, desiredLongEdge: number, maximumLongEdge: number) {
  const sourceWidth = integerExtent(width);
  const sourceHeight = integerExtent(height);
  const cap = integerExtent(maximumLongEdge);
  const target = bounded(Math.round(numberOr(desiredLongEdge, 1)), 1, cap);
  const factor = target / Math.max(sourceWidth, sourceHeight);
  return { width: Math.max(1, Math.round(sourceWidth * factor)), height: Math.max(1, Math.round(sourceHeight * factor)) };
}

export function atlasBoundedAngle(value: number, minimum: number, maximum: number) {
  return bounded(numberOr(value), minimum, maximum);
}

export const ATLAS_EDITOR_MIN_ZOOM = ATLAS_EDITOR_ZOOM.min;
export const ATLAS_EDITOR_MAX_ZOOM = ATLAS_EDITOR_ZOOM.max;

export function normalizeAtlasEditorSize(size: AtlasImageSize | null | undefined): AtlasImageSize {
  return size ? { width: mediaDimension(size.width), height: mediaDimension(size.height) } : { width: 0, height: 0 };
}

export function fitAtlasImageToViewport(imageInput: AtlasImageSize | null, viewportInput: AtlasImageSize, padding = ATLAS_EDITOR_PADDING): AtlasImageSize {
  const image = normalizeAtlasEditorSize(imageInput);
  const viewport = normalizeAtlasEditorSize(viewportInput);
  if (!image.width || !image.height || !viewport.width || !viewport.height) return { width: 0, height: 0 };
  const inset = Math.max(0, numberOr(padding));
  const availableWidth = Math.max(1, viewport.width - 2 * inset);
  const availableHeight = Math.max(1, viewport.height - 2 * inset);
  const scale = Math.min(1, availableWidth / image.width, availableHeight / image.height);
  return { width: Math.max(1, Math.floor(image.width * scale)), height: Math.max(1, Math.floor(image.height * scale)) };
}

export function clampAtlasEditorZoom(value: number) {
  return bounded(value, ATLAS_EDITOR_MIN_ZOOM, ATLAS_EDITOR_MAX_ZOOM);
}

export function atlasEditorLayout(baseInput: AtlasImageSize, viewportInput: AtlasImageSize, zoomInput: number): AtlasEditorLayout {
  const base = normalizeAtlasEditorSize(baseInput);
  const viewport = normalizeAtlasEditorSize(viewportInput);
  const zoom = clampAtlasEditorZoom(zoomInput);
  const stageSize = { width: base.width * zoom, height: base.height * zoom };
  const contentSize = { width: Math.max(viewport.width, stageSize.width), height: Math.max(viewport.height, stageSize.height) };
  return {
    stageSize,
    contentSize,
    stageOffset: {
      x: Math.max(0, Math.round((contentSize.width - stageSize.width) / 2)),
      y: Math.max(0, Math.round((contentSize.height - stageSize.height) / 2)),
    },
  };
}

export function atlasZoomAnchorAtPoint(input: {
  baseSize: AtlasImageSize;
  viewport: AtlasEditorRect;
  scroll: AtlasEditorPoint;
  currentZoom: number;
  nextZoom: number;
  clientPoint?: AtlasEditorPoint;
  previousAnchor?: AtlasEditorZoomAnchor | null;
}): AtlasEditorZoomAnchor | null {
  const base = normalizeAtlasEditorSize(input.baseSize);
  const viewportSize = normalizeAtlasEditorSize(input.viewport);
  if (!base.width || !base.height || !viewportSize.width || !viewportSize.height) return null;
  const zoom = clampAtlasEditorZoom(input.nextZoom);
  const currentZoom = clampAtlasEditorZoom(input.currentZoom);
  if (Math.abs(zoom - currentZoom) < 0.001) return null;
  const center = { x: input.viewport.left + input.viewport.width / 2, y: input.viewport.top + input.viewport.height / 2 };
  const pointer = input.clientPoint ?? center;
  const viewportX = numberOr(pointer.x, center.x) - input.viewport.left;
  const viewportY = numberOr(pointer.y, center.y) - input.viewport.top;
  const prior = input.previousAnchor;
  const currentLayout = atlasEditorLayout(base, viewportSize, currentZoom);
  const effectiveScroll = prior && Math.abs(prior.zoom - currentZoom) < 0.001
    ? {
        x: currentLayout.stageOffset.x + prior.ratioX * currentLayout.stageSize.width - prior.viewportX,
        y: currentLayout.stageOffset.y + prior.ratioY * currentLayout.stageSize.height - prior.viewportY,
      }
    : input.scroll;
  const stageLeft = input.viewport.left + currentLayout.stageOffset.x - numberOr(effectiveScroll.x);
  const stageTop = input.viewport.top + currentLayout.stageOffset.y - numberOr(effectiveScroll.y);
  const ratioX = (numberOr(pointer.x, center.x) - stageLeft) / currentLayout.stageSize.width;
  const ratioY = (numberOr(pointer.y, center.y) - stageTop) / currentLayout.stageSize.height;
  return { zoom, ratioX: bounded(numberOr(ratioX, 0.5), 0, 1), ratioY: bounded(numberOr(ratioY, 0.5), 0, 1), viewportX, viewportY };
}

export function atlasScrollForZoomAnchor(anchor: AtlasEditorZoomAnchor, baseSize: AtlasImageSize, viewportSize: AtlasImageSize) {
  const layout = atlasEditorLayout(baseSize, viewportSize, anchor.zoom);
  return {
    left: layout.stageOffset.x + anchor.ratioX * layout.stageSize.width - anchor.viewportX,
    top: layout.stageOffset.y + anchor.ratioY * layout.stageSize.height - anchor.viewportY,
  };
}

export function atlasImageEditorPanScroll(pan: AtlasEditorPanState, pointer: AtlasEditorPoint) {
  return {
    left: Math.max(0, pan.scrollLeft - (numberOr(pointer.x, pan.pointerX) - pan.pointerX)),
    top: Math.max(0, pan.scrollTop - (numberOr(pointer.y, pan.pointerY) - pan.pointerY)),
  };
}
