import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import type { UploadedFile } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";

export type AtlasMediaKind = "image" | "video" | "audio";

export type AtlasMediaFile = Readonly<{
  name: string;
  type: string;
}>;

export type AtlasMediaImportTarget = Readonly<{
  nodeId?: string;
  position?: Position;
}>;

export type AtlasMediaPlacement<TFile extends AtlasMediaFile = AtlasMediaFile> = Readonly<{
  file: TFile;
  kind: AtlasMediaKind;
  position: Position;
}>;

export type AtlasMediaImportPlan<TFile extends AtlasMediaFile = AtlasMediaFile> = Readonly<{
  replacement: (AtlasMediaPlacement<TFile> & { nodeId: string }) | null;
  additions: readonly AtlasMediaPlacement<TFile>[];
}>;

export type AtlasMediaReplacement = Readonly<{
  fileName: string;
  kind: AtlasMediaKind;
  media: UploadedImage | UploadedFile;
}>;

export type AtlasAngleImageOptions = Readonly<Partial<CanvasNodeMetadata>>;

export type AtlasSplitPiece = Readonly<{
  id: string;
  title: string;
  row: number;
  column: number;
  image: UploadedImage;
}>;

export type AtlasSplitGrid = Readonly<{ rows: number; columns: number }>;

const IMPORT_STAGGER = 40;
const RESULT_GAP = 96;
const TILE_GAP = 16;
const IMAGE_MAX_SIZE = { width: 640, height: 640 };
const VIDEO_DEFAULT_SIZE = { width: 420, height: 236 };
const AUDIO_DEFAULT_SIZE = { width: 340, height: 120 };

export function classifyAtlasMedia<TFile extends AtlasMediaFile>(
  file: TFile,
  isAudioFile: (candidate: TFile) => boolean = isRecognizedAudio,
): AtlasMediaKind | null {
  const mime = file.type.trim().toLowerCase();
  const name = file.name.trim().toLowerCase();
  if (isAudioFile(file) || mime.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(name)) return "audio";
  if (mime.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(name)) return "video";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp|tiff?)$/i.test(name)) return "image";
  return null;
}

export function planAtlasMediaImport<TFile extends AtlasMediaFile>(
  files: readonly TFile[],
  target: AtlasMediaImportTarget | null,
  canvasCenter: Position,
  isAudioFile: (candidate: TFile) => boolean = isRecognizedAudio,
): AtlasMediaImportPlan<TFile> {
  const accepted = files.flatMap((file) => {
    const kind = classifyAtlasMedia(file, isAudioFile);
    return kind ? [{ file, kind }] : [];
  });
  const origin = copyPosition(target?.position ?? canvasCenter);
  const replacement = target?.nodeId && accepted.length > 0
    ? { ...accepted[0], nodeId: target.nodeId, position: origin }
    : null;
  const additions = accepted.slice(replacement ? 1 : 0).map((item, index) => ({
    ...item,
    position: {
      x: origin.x + IMPORT_STAGGER * (index + Number(Boolean(replacement))),
      y: origin.y + IMPORT_STAGGER * (index + Number(Boolean(replacement))),
    },
  }));
  return { replacement, additions };
}

export function applyAtlasMediaReplacement(
  nodes: readonly CanvasNodeData[],
  nodeId: string,
  replacement: AtlasMediaReplacement,
  bounds?: Readonly<{ width: number; height: number }>,
): CanvasNodeData[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;
    const type = nodeTypeFor(replacement.kind);
    const fallback = defaultSizeFor(replacement.kind);
    const limit = replacement.kind === "image"
      ? IMAGE_MAX_SIZE
      : replacement.kind === "video"
        ? bounds ?? VIDEO_DEFAULT_SIZE
        : fallback;
    const size = replacement.kind === "audio"
      ? fallback
      : fitWithin(replacement.media.width, replacement.media.height, limit.width, limit.height, fallback);
    const metadata = {
      ...node.metadata,
      content: replacement.media.url,
      storageKey: replacement.media.storageKey,
      status: "success" as const,
      errorDetails: undefined,
      prompt: undefined,
      composerContent: undefined,
      generationMode: undefined,
      generationType: undefined,
      model: undefined,
      reasoningEffort: undefined,
      count: undefined,
      textCount: undefined,
      size: undefined,
      quality: undefined,
      background: undefined,
      references: undefined,
      images: undefined,
      primaryImageId: undefined,
      texts: undefined,
      primaryTextId: undefined,
      naturalWidth: replacement.media.width || undefined,
      naturalHeight: replacement.media.height || undefined,
      bytes: replacement.media.bytes,
      mimeType: replacement.media.mimeType,
      freeResize: replacement.kind === "image" ? false : undefined,
    };
    const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
    return {
      ...node,
      type,
      title: replacement.fileName,
      position: replacement.kind === "image"
        ? node.position
        : { x: center.x - size.width / 2, y: center.y - size.height / 2 },
      width: size.width,
      height: size.height,
      metadata,
    };
  });
}

export function createAtlasAngleImageDraft(
  source: Pick<CanvasNodeData, "position" | "width" | "height">,
  id: string,
  title: string,
  prompt: string,
  options: AtlasAngleImageOptions = {},
): CanvasNodeData {
  return {
    id,
    type: CanvasNodeType.Image,
    title,
    position: { x: source.position.x + source.width + RESULT_GAP, y: source.position.y },
    width: 340,
    height: 240,
    metadata: {
      ...options,
      prompt,
      status: "loading",
      generationMode: options.generationMode ?? "image",
    },
  };
}

export function applyAtlasAngleImageResult(
  draft: CanvasNodeData,
  media: UploadedImage,
  prompt: string,
  options: AtlasAngleImageOptions = {},
  bounds = IMAGE_MAX_SIZE,
): CanvasNodeData {
  const size = fitWithin(media.width, media.height, bounds.width, bounds.height, { width: draft.width, height: draft.height });
  return {
    ...draft,
    width: size.width,
    height: size.height,
    metadata: {
      ...draft.metadata,
      ...options,
      content: media.url,
      storageKey: media.storageKey,
      status: "success",
      errorDetails: undefined,
      prompt,
      generationMode: options.generationMode ?? "image",
      naturalWidth: media.width || undefined,
      naturalHeight: media.height || undefined,
      bytes: media.bytes,
      mimeType: media.mimeType,
    },
  };
}

export function createAtlasCropImageResult(
  source: CanvasNodeData,
  id: string,
  media: UploadedImage,
): CanvasNodeData {
  const size = fitWithin(media.width, media.height, source.width, source.height, source);
  return createCompletedImageNode(source, id, "Cropped Image", media, size, {
    x: source.position.x + source.width + RESULT_GAP,
    y: source.position.y,
  });
}

export function createAtlasUpscaleImageResult(
  source: CanvasNodeData,
  id: string,
  media: UploadedImage,
): CanvasNodeData {
  const size = fitWithin(media.width, media.height, IMAGE_MAX_SIZE.width, IMAGE_MAX_SIZE.height, source);
  return createCompletedImageNode(source, id, "Upscaled Image", media, size, {
    x: source.position.x + source.width + RESULT_GAP,
    y: source.position.y,
  });
}

export function createAtlasSplitImageResults(
  source: CanvasNodeData,
  pieces: readonly AtlasSplitPiece[],
  grid: AtlasSplitGrid,
): CanvasNodeData[] {
  const rows = finiteInteger(grid.rows);
  const columns = finiteInteger(grid.columns);
  if (rows < 1 || columns < 1 || rows > 24 || columns > 24) return [];
  const cellWidth = source.width / columns;
  const cellHeight = source.height / rows;
  const originX = source.position.x + source.width + RESULT_GAP;
  return pieces
    .filter((piece) => Number.isInteger(piece.row) && Number.isInteger(piece.column)
      && piece.row >= 0 && piece.row < rows && piece.column >= 0 && piece.column < columns)
    .map((piece) => createCompletedImageNode(
      source,
      piece.id,
      piece.title,
      piece.image,
      { width: cellWidth, height: cellHeight },
      {
        x: originX + piece.column * (cellWidth + TILE_GAP),
        y: source.position.y + piece.row * (cellHeight + TILE_GAP),
      },
    ));
}

function createCompletedImageNode(
  source: CanvasNodeData,
  id: string,
  title: string,
  media: UploadedImage,
  size: Readonly<{ width: number; height: number }>,
  position: Position,
): CanvasNodeData {
  return {
    id,
    type: CanvasNodeType.Image,
    title,
    position: copyPosition(position),
    width: size.width,
    height: size.height,
    metadata: {
      content: media.url,
      storageKey: media.storageKey,
      naturalWidth: media.width || undefined,
      naturalHeight: media.height || undefined,
      bytes: media.bytes,
      mimeType: media.mimeType,
      prompt: source.metadata?.prompt,
      status: "success",
      generationMode: "image",
    },
  };
}

function fitWithin(
  width: number | undefined,
  height: number | undefined,
  maxWidth: number,
  maxHeight: number,
  fallback: Readonly<{ width: number; height: number }>,
) {
  const w = positive(width);
  const h = positive(height);
  const boundW = positive(maxWidth);
  const boundH = positive(maxHeight);
  if (!w || !h || !boundW || !boundH) return { width: fallback.width, height: fallback.height };
  const factor = Math.min(1, boundW / w, boundH / h);
  return { width: round(w * factor), height: round(h * factor) };
}

function nodeTypeFor(kind: AtlasMediaKind): CanvasNodeType {
  if (kind === "video") return CanvasNodeType.Video;
  if (kind === "audio") return CanvasNodeType.Audio;
  return CanvasNodeType.Image;
}

function defaultSizeFor(kind: AtlasMediaKind) {
  if (kind === "video") return VIDEO_DEFAULT_SIZE;
  if (kind === "audio") return AUDIO_DEFAULT_SIZE;
  return IMAGE_MAX_SIZE;
}

function isRecognizedAudio(file: AtlasMediaFile) {
  return /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(file.name);
}

function positive(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function finiteInteger(value: number) {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function copyPosition(value: Position): Position {
  return { x: Number.isFinite(value.x) ? value.x : 0, y: Number.isFinite(value.y) ? value.y : 0 };
}
