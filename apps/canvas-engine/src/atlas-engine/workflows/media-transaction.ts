import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import type { InsertAssetPayload } from "@/atlas-engine/ui/asset-picker";
import type { UploadedFile, MediaUploadOptions } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";
import type { AtlasCommand } from "@/atlas-engine/reducer";
import { getDataUrlByteSize } from "@/lib/image-utils";
import type { CanvasAssistantImage } from "@/types/canvas/assistant";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type Position,
} from "@/types/canvas";
import { fitAtlasNodeSize as fitNodeSize } from "@/atlas-engine/model/node-size";
import {
  atlasAudioMetadata as audioMetadata,
  atlasImageMetadata as imageMetadata,
  atlasVideoMetadata as videoMetadata,
  createAtlasNode,
} from "@/atlas-engine/model/node-factory";

export type AtlasMediaKind = "image" | "video" | "audio";

export type AtlasMediaFile = Pick<File, "name" | "type">;

export type AtlasMediaUploaders = {
  uploadImage: (
    input: string | Blob,
    options?: { signal?: AbortSignal },
  ) => Promise<UploadedImage>;
  uploadMediaFile: (
    input: string | Blob,
    prefix?: string,
    options?: MediaUploadOptions,
  ) => Promise<UploadedFile>;
};

export type AtlasMediaRollback = (
  media: UploadedImage | UploadedFile,
) => Promise<void>;

export type AtlasTransferContext = Readonly<{
  signal: AbortSignal;
  assertCurrent: () => void;
  retain: (media: UploadedImage | UploadedFile) => void;
}>;

export type AtlasTransferOutcome<T> =
  | Readonly<{ status: "committed"; value: T }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "failed"; error: Error }>;

/** Coordinates ownership and cancellation; only a successful commit keeps uploaded data. */
export function createAtlasMediaTransactions(rollback: AtlasMediaRollback) {
  const active = new Map<
    symbol,
    { controller: AbortController; channel?: string }
  >();
  return {
    cancelAll() {
      for (const task of active.values()) task.controller.abort();
      active.clear();
    },
    async run<T>(
      options: Readonly<{
        channel?: string;
        isCurrent: () => boolean;
        prepare: (context: AtlasTransferContext) => Promise<T>;
        commit: (value: T) => void;
      }>,
    ): Promise<AtlasTransferOutcome<T>> {
      if (options.channel) {
        for (const task of active.values()) {
          if (task.channel === options.channel) task.controller.abort();
        }
      }
      const id = Symbol("media-transfer");
      const controller = new AbortController();
      const resources = new Map<string, UploadedImage | UploadedFile>();
      active.set(id, { controller, channel: options.channel });
      const assertCurrent = () => {
        assertActive(controller.signal);
        if (!options.isCurrent())
          throw new DOMException("Project changed", "AbortError");
      };
      let committed = false;
      try {
        assertCurrent();
        const value = await options.prepare({
          signal: controller.signal,
          assertCurrent,
          retain(media) {
            if (media.storageKey) resources.set(media.storageKey, media);
          },
        });
        assertCurrent();
        options.commit(value);
        committed = true;
        return { status: "committed", value };
      } catch (error) {
        if (
          controller.signal.aborted ||
          !options.isCurrent() ||
          (error instanceof Error && error.name === "AbortError")
        )
          return { status: "cancelled" };
        return {
          status: "failed",
          error: error instanceof Error ? error : new Error(String(error)),
        };
      } finally {
        active.delete(id);
        if (!committed)
          await Promise.allSettled(
            [...resources.values()].map((media) => rollback(media)),
          );
      }
    },
  };
}

/** Nodes, edges, and selection enter the document in one validated reducer batch. */
export function atlasMediaCommitCommands(
  nodes: readonly CanvasNodeData[],
  edges: readonly CanvasConnection[] = [],
): readonly AtlasCommand[] {
  if (!nodes.length) return [];
  return [
    ...nodes.map((node): AtlasCommand => ({
      type: "upsert-node",
      node: {
        id: node.id,
        kind: node.type,
        title: node.title,
        frame: { ...node.position, width: node.width, height: node.height },
        data: { ...node.metadata },
      },
    })),
    ...edges.map((edge): AtlasCommand => ({
      type: "connect",
      edge: { id: edge.id, source: edge.fromNodeId, target: edge.toNodeId },
    })),
    { type: "select", nodeIds: nodes.map((node) => node.id) },
  ];
}

export type AtlasMediaImportResult = Readonly<{
  node: CanvasNodeData;
  media: UploadedImage | UploadedFile;
}>;

export type AtlasClipboardPayload =
  | Readonly<{ kind: "image"; blob: Blob; mimeType: string }>
  | Readonly<{ kind: "text"; text: string }>;

export type AtlasClipboardReader = Readonly<{
  read: () => Promise<readonly AtlasClipboardItem[]>;
  readText: () => Promise<string>;
}>;

export type AtlasClipboardItem = Readonly<{
  types: readonly string[];
  getType: (type: string) => Promise<Blob>;
}>;

export type AtlasAssetLabels = Readonly<{
  canvasText: string;
  canvasImage: string;
  canvasVideo: string;
}>;

export type AtlasAssistantImageDependencies = Readonly<{
  uploadImage: AtlasMediaUploaders["uploadImage"];
  ensureImagePreview: (storageKey?: string) => Promise<string | undefined>;
  readImageMeta: (url: string) => Promise<{ width: number; height: number }>;
  resolveImageUrl: (storageKey?: string, fallback?: string) => Promise<string>;
}>;

const IMAGE_MAX = { width: 640, height: 640 } as const;
const VIDEO_MAX = { width: 420, height: 420 } as const;

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Operation cancelled", "AbortError");
  }
}

function centered(position: Position, width: number, height: number): Position {
  return { x: position.x - width / 2, y: position.y - height / 2 };
}

function mediaNode(
  kind: AtlasMediaKind,
  fileName: string,
  position: Position,
  media: UploadedImage | UploadedFile,
): CanvasNodeData {
  const type =
    kind === "image"
      ? CanvasNodeType.Image
      : kind === "video"
        ? CanvasNodeType.Video
        : CanvasNodeType.Audio;
  const fallback = NODE_DEFAULT_SIZE[type];
  const size =
    kind === "image"
      ? fitNodeSize(
          media.width || fallback.width,
          media.height || fallback.height,
          IMAGE_MAX.width,
          IMAGE_MAX.height,
        )
      : kind === "video"
        ? fitNodeSize(
            media.width || fallback.width,
            media.height || fallback.height,
            VIDEO_MAX.width,
            VIDEO_MAX.height,
          )
        : fallback;
  const metadata =
    kind === "image"
      ? imageMetadata(media as UploadedImage)
      : kind === "video"
        ? videoMetadata(media as UploadedFile)
        : audioMetadata(media as UploadedFile);
  return {
    id: `${type}-${nanoid(10)}`,
    type,
    title: fileName,
    position: centered(position, size.width, size.height),
    width: size.width,
    height: size.height,
    metadata,
  };
}

async function importAtlasMediaFile(
  file: File,
  kind: AtlasMediaKind,
  position: Position,
  uploaders: AtlasMediaUploaders,
  signal?: AbortSignal,
): Promise<AtlasMediaImportResult> {
  assertActive(signal);
  const media =
    kind === "image"
      ? await uploaders.uploadImage(file, { signal })
      : await uploaders.uploadMediaFile(file, kind, { signal });
  return { media, node: mediaNode(kind, file.name, position, media) };
}

/** Uploads the whole batch before exposing any node, so callers can commit once. */
export async function importAtlasMediaBatch(
  entries: readonly Readonly<{
    file: File;
    kind: AtlasMediaKind;
    position: Position;
  }>[],
  uploaders: AtlasMediaUploaders,
  options: Readonly<{
    signal?: AbortSignal;
    rollback?: AtlasMediaRollback;
  }> = {},
): Promise<readonly AtlasMediaImportResult[]> {
  const completed: AtlasMediaImportResult[] = [];
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let cursor = 0;
  let failure: unknown;
  const worker = async () => {
    try {
      while (cursor < entries.length) {
        assertActive(controller.signal);
        const index = cursor++;
        const entry = entries[index]!;
        completed[index] = await importAtlasMediaFile(
          entry.file,
          entry.kind,
          entry.position,
          uploaders,
          controller.signal,
        );
      }
    } catch (error) {
      failure ??= error;
      controller.abort(error);
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(3, entries.length) }, worker),
    );
    if (failure !== undefined) throw failure;
    assertActive(controller.signal);
    return completed;
  } catch (error) {
    if (options.rollback) {
      await Promise.allSettled(
        completed.flatMap((result) =>
          result ? [options.rollback!(result.media)] : [],
        ),
      );
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}

export function createAtlasClipboardTextNode(
  text: string,
  center: Position,
  title: string,
): CanvasNodeData | null {
  const content = text.trim();
  if (!content) return null;
  const node = createAtlasNode(CanvasNodeType.Text, center, {
    content,
    status: "success",
  });
  return { ...node, title: content.slice(0, 32) || title };
}

export async function readAtlasClipboard(
  clipboard: AtlasClipboardReader,
  signal?: AbortSignal,
): Promise<AtlasClipboardPayload | null> {
  assertActive(signal);
  let items: readonly AtlasClipboardItem[] = [];
  try {
    items = await clipboard.read();
  } catch {
    assertActive(signal);
  }
  assertActive(signal);
  const imageItem = items.find((item) =>
    item.types.some((type) => type.startsWith("image/")),
  );
  if (imageItem) {
    const mimeType = imageItem.types.find((type) => type.startsWith("image/"));
    if (!mimeType) return null;
    const blob = await imageItem.getType(mimeType);
    assertActive(signal);
    return { kind: "image", blob, mimeType };
  }
  const text = await clipboard.readText();
  assertActive(signal);
  return text.trim() ? { kind: "text", text } : null;
}

export function buildAtlasCapturedFrameNode(
  source: Pick<CanvasNodeData, "position" | "width" | "height" | "title">,
  image: UploadedImage,
  position: Position,
  title: string,
): CanvasNodeData {
  const size = fitNodeSize(
    image.width,
    image.height,
    VIDEO_MAX.width,
    VIDEO_MAX.height,
  );
  return {
    id: `image-${nanoid(10)}`,
    type: CanvasNodeType.Image,
    title: title || source.title,
    position,
    width: size.width,
    height: size.height,
    metadata: imageMetadata(image),
  };
}

export function atlasMediaOutputPosition(
  source: CanvasNodeData,
  nodes: readonly CanvasNodeData[],
  size: Readonly<{ width: number; height: number }>,
): Position {
  const x = source.position.x + source.width + 96;
  let y = source.position.y + (source.height - size.height) / 2;
  const occupied = nodes
    .filter(
      (node) =>
        node.id !== source.id &&
        node.position.x < x + size.width &&
        node.position.x + node.width > x,
    )
    .sort((left, right) => left.position.y - right.position.y);
  for (const node of occupied) {
    if (node.position.y < y + size.height && node.position.y + node.height > y)
      y = node.position.y + node.height + 24;
  }
  return { x, y };
}

export function buildAtlasAssetDraft(
  node: CanvasNodeData,
  labels: AtlasAssetLabels,
): Omit<Asset, "id" | "createdAt" | "updatedAt"> | null {
  const metadata = node.metadata || {};
  const content = metadata.content?.trim();
  if (!content) return null;
  if (
    ![CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Video].includes(
      node.type as CanvasNodeType,
    )
  )
    return null;
  const title =
    metadata.prompt?.slice(0, 24) ||
    (node.type === CanvasNodeType.Text
      ? labels.canvasText
      : node.type === CanvasNodeType.Video
        ? labels.canvasVideo
        : labels.canvasImage);
  const base = {
    title,
    coverUrl: node.type === CanvasNodeType.Text ? "" : content,
    tags: [],
    source: "Canvas",
    metadata: {
      source: "canvas",
      nodeId: node.id,
      prompt: node.metadata?.prompt,
    },
  };
  if (node.type === CanvasNodeType.Text)
    return { ...base, kind: "text", data: { content } };
  if (node.type === CanvasNodeType.Video)
    return {
      ...base,
      kind: "video",
      data: {
        url: content,
        storageKey: metadata.storageKey,
        width: node.width,
        height: node.height,
        bytes: metadata.bytes || 0,
        mimeType: metadata.mimeType || "video/mp4",
      },
    };
  const dataUrl = metadata.storageKey ? "" : content;
  return {
    ...base,
    kind: "image",
    data: {
      dataUrl,
      storageKey: metadata.storageKey,
      width: metadata.naturalWidth || node.width,
      height: metadata.naturalHeight || node.height,
      bytes: metadata.bytes || getDataUrlByteSize(dataUrl),
      mimeType: metadata.mimeType || "image/png",
    },
  };
}

export async function createAtlasAssistantImageNode(
  image: CanvasAssistantImage,
  center: Position,
  dependencies: AtlasAssistantImageDependencies,
  signal?: AbortSignal,
  retain: (media: UploadedImage) => void = () => undefined,
): Promise<CanvasNodeData> {
  assertActive(signal);
  const stored = image.storageKey
    ? {
        url: await dependencies.resolveImageUrl(
          image.storageKey,
          image.dataUrl,
        ),
        storageKey: image.storageKey,
        width: 1,
        height: 1,
        bytes: 0,
        mimeType: "image/png",
      }
    : await dependencies.uploadImage(image.dataUrl, { signal });
  if (!image.storageKey) retain(stored);
  if (!stored.url.trim()) throw new Error("图片素材地址不可用，请重新导入");
  await dependencies.ensureImagePreview(stored.storageKey);
  const dimensions =
    stored.width === 1 && stored.height === 1
      ? await dependencies.readImageMeta(stored.url)
      : stored;
  assertActive(signal);
  const size = fitNodeSize(
    dimensions.width,
    dimensions.height,
    IMAGE_MAX.width,
    IMAGE_MAX.height,
  );
  return {
    id: `image-${nanoid(10)}`,
    type: CanvasNodeType.Image,
    title: image.prompt.slice(0, 32) || "Generated Image",
    position: centered(center, size.width, size.height),
    width: size.width,
    height: size.height,
    metadata: {
      ...imageMetadata({
        ...stored,
        width: dimensions.width,
        height: dimensions.height,
      }),
      prompt: image.prompt,
    },
  };
}

export function createAtlasAssistantTextNode(
  text: string,
  center: Position,
  title?: string,
): CanvasNodeData | null {
  const node = createAtlasClipboardTextNode(text, center, "Assistant Text");
  return node ? { ...node, title: title || node.title } : null;
}

export function createAtlasAssetNode(
  payload: Exclude<InsertAssetPayload, { kind: "image" }>,
  center: Position,
): CanvasNodeData | null {
  if (payload.kind === "text")
    return createAtlasAssistantTextNode(payload.content, center, payload.title);
  if (!payload.url.trim()) return null;
  const size = fitNodeSize(
    payload.width || NODE_DEFAULT_SIZE[CanvasNodeType.Video].width,
    payload.height || NODE_DEFAULT_SIZE[CanvasNodeType.Video].height,
    VIDEO_MAX.width,
    VIDEO_MAX.height,
  );
  return {
    id: `video-${nanoid(10)}`,
    type: CanvasNodeType.Video,
    title: payload.title,
    position: centered(center, size.width, size.height),
    width: size.width,
    height: size.height,
    metadata: {
      content: payload.url,
      storageKey: payload.storageKey,
      status: "success",
      naturalWidth: payload.width,
      naturalHeight: payload.height,
    },
  };
}
