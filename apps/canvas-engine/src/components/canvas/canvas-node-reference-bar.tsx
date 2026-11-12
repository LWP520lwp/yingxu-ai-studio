import { Popover } from "antd";
import {
  FileText,
  GripVertical,
  Image as ImageIcon,
  Music2,
  Plus,
  Puzzle,
  Video,
  X,
} from "lucide-react";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type DragEventHandler,
} from "react";
import { useTranslation } from "react-i18next";

import {
  canSwapFrameDrop,
  createReferenceItems,
  expandReferenceSources,
  referenceSourcesToDisconnect,
} from "@/lib/canvas/canvas-reference-bar";
import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import {
  getImagePreviewRevision,
  previewUrlFor,
  subscribeImagePreviews,
} from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import {
  buildNodeGenerationContext,
  frameReferenceIssue,
} from "./canvas-node-generation";

type CanvasNodeReferenceBarProps = {
  nodeId: string;
  nodes: CanvasNodeData[];
  connectedNodes: CanvasNodeData[];
  onDisconnect?: (fromNodeId: string, toNodeId: string) => void;
  onStartSelection?: (nodeId: string) => void;
  frameMode?: boolean;
  framesReversed?: boolean;
  onSwapFrames?: () => void;
  prompt?: string;
};

export function CanvasNodeReferenceBar({
  nodeId,
  nodes,
  connectedNodes,
  onDisconnect,
  onStartSelection,
  frameMode = false,
  framesReversed = false,
  onSwapFrames,
  prompt,
}: CanvasNodeReferenceBarProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const [draggedFrameId, setDraggedFrameId] = useState<string | null>(null);
  const [dropFrameId, setDropFrameId] = useState<string | null>(null);
  const target = nodes.find((node) => node.id === nodeId);
  const sources = expandReferenceSources(connectedNodes, nodes);
  const generationImages = frameMode
    ? buildNodeGenerationContext(
        nodeId,
        nodes,
        connectedNodes.map((node) => ({
          id: node.id,
          fromNodeId: node.id,
          toNodeId: nodeId,
        })),
        prompt ??
          target?.metadata?.composerContent ??
          target?.metadata?.prompt ??
          "",
        { frameMode: true },
      ).referenceImages
    : [];
  const items = createReferenceItems(
    sources,
    frameMode,
    generationImages.map((image) => image.id),
    framesReversed,
  );
  const orderedImages = framesReversed
    ? [...generationImages].reverse()
    : generationImages;
  const frameIds = orderedImages.map((image) => image.id);
  const itemById = new Map(items.map((item) => [item.node.id, item]));
  const frameItems = frameIds.flatMap((id) => {
    const item = itemById.get(id);
    return item ? [item] : [];
  });
  const visibleFrameIds = new Set(frameItems.map((item) => item.node.id));
  const supportingItems = items.filter(
    (item) => !visibleFrameIds.has(item.node.id),
  );
  const frameIssue = frameReferenceIssue(orderedImages.length);

  const removeReference = (referenceNodeId: string, sourceNodeId: string) => {
    referenceSourcesToDisconnect(
      sources,
      referenceNodeId,
      sourceNodeId,
      frameMode,
    ).forEach((source) => onDisconnect?.(source, nodeId));
  };

  const handleFrameDrop = (targetId: string) => {
    if (
      draggedFrameId &&
      canSwapFrameDrop(frameIds, draggedFrameId, targetId)
    ) {
      onSwapFrames?.();
    }
    setDraggedFrameId(null);
    setDropFrameId(null);
  };

  return (
    <section className="mb-2 min-w-0" aria-label={t("canvas.references.title")}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div
          className="text-[11px] font-medium"
          style={{ color: theme.node.muted }}
        >
          {t("canvas.references.title")}
        </div>
        <span
          className="text-[10px] tabular-nums"
          style={{ color: theme.node.muted }}
        >
          {items.length}
        </span>
      </div>

      {frameMode ? (
        <div className="grid grid-cols-2 gap-1.5">
          {(["首帧", "尾帧"] as const).map((slot, index) => {
            const slotLabel = t(
              slot === "首帧"
                ? "canvas.references.frames.first"
                : "canvas.references.frames.last",
            );
            const item = frameItems[index];
            const canReorder = frameIds.length === 2 && Boolean(onSwapFrames);
            const isDropTarget = item && dropFrameId === item.node.id;
            return item ? (
              <ReferenceToken
                key={`${item.sourceNodeId}:${item.node.id}`}
                node={item.node}
                frameLabel={slot}
                frameSlot
                draggable={canReorder}
                isDragging={draggedFrameId === item.node.id}
                isDropTarget={Boolean(isDropTarget)}
                onDragStart={(event) => {
                  if (!canReorder) return;
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", item.node.id);
                  setDraggedFrameId(item.node.id);
                }}
                onDragOver={(event) => {
                  if (!canReorder || draggedFrameId === item.node.id) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDropFrameId(item.node.id);
                }}
                onDrop={(event) => {
                  if (!canReorder) return;
                  event.preventDefault();
                  event.stopPropagation();
                  handleFrameDrop(item.node.id);
                }}
                onDragEnd={() => {
                  setDraggedFrameId(null);
                  setDropFrameId(null);
                }}
                onRemove={() =>
                  removeReference(item.node.id, item.sourceNodeId)
                }
              />
            ) : (
              <button
                key={slot}
                type="button"
                className="flex h-16 min-w-0 items-center gap-2 rounded-md border border-dashed px-2 text-left transition hover:opacity-75"
                style={{
                  borderColor: theme.toolbar.border,
                  color: theme.node.muted,
                }}
                aria-label={t("canvas.references.addFrame", {
                  frame: slotLabel,
                })}
                onClick={() => onStartSelection?.(nodeId)}
              >
                <Plus className="size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[11px] font-medium">
                    {slotLabel}
                  </span>
                  <span className="block truncate text-[10px] opacity-65">
                    {t("canvas.references.pendingImage")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        className={`thin-scrollbar flex min-h-12 items-stretch gap-1.5 overflow-x-auto pb-1 ${frameMode ? "mt-1.5" : ""}`}
      >
        {(frameMode ? supportingItems : items).map(
          ({ node, sourceNodeId, frameLabel }) => (
            <ReferenceToken
              key={`${sourceNodeId}:${node.id}`}
              node={node}
              frameLabel={frameLabel}
              onRemove={() => removeReference(node.id, sourceNodeId)}
            />
          ),
        )}

        {!frameMode ? (
          <button
            type="button"
            className="grid size-12 shrink-0 place-items-center rounded-md border border-dashed bg-transparent transition hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              borderColor: theme.toolbar.border,
              color: theme.node.muted,
            }}
            aria-label={t("canvas.references.select")}
            title={t("canvas.references.select")}
            onClick={() => onStartSelection?.(nodeId)}
          >
            <Plus className="size-4" />
          </button>
        ) : null}
      </div>

      {frameMode ? (
        <div
          className="mt-1 flex items-start justify-between gap-2 text-xs"
          style={{ color: theme.node.muted }}
        >
          <span
            className="min-w-0"
            role={orderedImages.length > 2 ? "alert" : "status"}
          >
            {frameIssue ||
              (orderedImages.length === 1
                ? t("canvas.references.firstFrameOnly")
                : t("canvas.references.orderHint"))}
          </span>
          {orderedImages.length === 2 && onSwapFrames ? (
            <button
              type="button"
              className="shrink-0 rounded border px-2 py-1"
              style={{ borderColor: theme.toolbar.border }}
              onClick={onSwapFrames}
            >
              {t("canvas.references.swapOrder")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type ReferenceTokenProps = {
  node: CanvasNodeData;
  frameLabel?: "首帧" | "尾帧" | "超出帧数";
  frameSlot?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onDragEnd?: DragEventHandler<HTMLDivElement>;
  onRemove: () => void;
};

function ReferenceToken({
  node,
  frameLabel,
  frameSlot = false,
  draggable = false,
  isDragging = false,
  isDropTarget = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onRemove,
}: ReferenceTokenProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const [previewFailed, setPreviewFailed] = useState(false);
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);

  const resource = getNodeDefinition(node.type)?.resource?.(node);
  const content = node.metadata?.content || resource?.url;
  const thumbnail = previewUrlFor(node.metadata?.storageKey) || content;
  useEffect(() => setPreviewFailed(false), [thumbnail]);
  const kind = getReferenceKind(node, resource?.kind);
  const Icon = iconForKind(kind);
  const title = node.title || t("canvas.references.empty");
  const translatedFrameLabel = frameLabel
    ? t(
        frameLabel === "首帧"
          ? "canvas.references.frames.first"
          : frameLabel === "尾帧"
            ? "canvas.references.frames.last"
            : "canvas.references.frames.overflow",
      )
    : undefined;

  return (
    <Popover
      placement="topLeft"
      mouseEnterDelay={0.15}
      content={<ReferencePreview node={node} content={content} />}
    >
      <div
        className={`group relative flex ${frameSlot ? "h-16 w-full" : "h-12 w-36"} min-w-0 shrink-0 items-center gap-2 overflow-hidden rounded-md border px-1.5 transition ${isDragging ? "opacity-40" : ""} ${isDropTarget ? "ring-2 ring-emerald-500 ring-offset-1" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{
          background: theme.toolbar.activeBg,
          borderColor: theme.toolbar.border,
        }}
        data-reference-node={node.id}
        aria-label={title}
        draggable={draggable}
        title={
          draggable
            ? t("canvas.references.dragSwap", {
                frame: translatedFrameLabel,
              })
            : title
        }
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
      >
        {draggable ? (
          <GripVertical
            className="size-3 shrink-0 opacity-35"
            aria-hidden="true"
          />
        ) : null}
        <span
          className={`${frameSlot ? "size-12" : "size-9"} grid shrink-0 place-items-center overflow-hidden rounded-sm bg-black/5 dark:bg-white/5`}
        >
          {kind === "image" && thumbnail && !previewFailed ? (
            <img
              src={thumbnail}
              alt=""
              className="size-full object-cover"
              onError={() => setPreviewFailed(true)}
            />
          ) : kind === "video" && content ? (
            <video
              src={content}
              className="size-full object-cover"
              muted
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <Icon className="size-4 opacity-70" aria-hidden="true" />
          )}
        </span>

        <span className="min-w-0 flex-1 self-center overflow-hidden">
          <span className="block truncate text-xs font-medium" title={title}>
            {title}
          </span>
          <span
            className="mt-0.5 block truncate text-[10px] opacity-65"
            title={kind}
          >
            {kindLabel(kind, t)}
          </span>
        </span>

        {frameLabel ? (
          <span
            className="absolute bottom-0 left-0 max-w-full truncate rounded-tr-sm bg-black/75 px-1.5 py-0.5 text-[9px] text-white"
            aria-label={translatedFrameLabel}
          >
            {translatedFrameLabel}
          </span>
        ) : null}

        <button
          type="button"
          className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-sm border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          style={{
            background: theme.toolbar.panel,
            borderColor: theme.toolbar.border,
            color: theme.node.muted,
          }}
          aria-label={`${t("canvas.references.disconnect")}: ${title}`}
          title={t("canvas.references.disconnect")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X className="size-3" />
        </button>
      </div>
    </Popover>
  );
}

type ReferenceKind = "image" | "video" | "audio" | "text" | "plugin";

function getReferenceKind(
  node: CanvasNodeData,
  pluginKind?: string,
): ReferenceKind {
  if (node.type === CanvasNodeType.Image || pluginKind === "image")
    return "image";
  if (node.type === CanvasNodeType.Video || pluginKind === "video")
    return "video";
  if (node.type === CanvasNodeType.Audio || pluginKind === "audio")
    return "audio";
  if (node.type === CanvasNodeType.Text || pluginKind === "text") return "text";
  return "plugin";
}

function iconForKind(kind: ReferenceKind) {
  switch (kind) {
    case "image":
      return ImageIcon;
    case "video":
      return Video;
    case "audio":
      return Music2;
    case "text":
      return FileText;
    case "plugin":
      return Puzzle;
  }
}

function kindLabel(kind: ReferenceKind, t: (key: string) => string) {
  switch (kind) {
    case "image":
      return t("canvas.nodeTypes.image");
    case "video":
      return t("canvas.nodeTypes.video");
    case "audio":
      return t("canvas.nodeTypes.audio");
    case "text":
      return t("canvas.nodeTypes.text");
    case "plugin":
      return t("canvas.toolbar.extensions");
  }
}

function ReferencePreview({
  node,
  content,
}: {
  node: CanvasNodeData;
  content?: string;
}) {
  const { t } = useTranslation();
  const resource = getNodeDefinition(node.type)?.resource?.(node);
  const kind = getReferenceKind(node, resource?.kind);

  if (kind === "image" && content) {
    return (
      <img
        src={content}
        alt={node.title}
        className="max-h-52 w-72 rounded-md object-contain"
      />
    );
  }
  if (kind === "video" && content) {
    return (
      <video
        src={content}
        className="max-h-52 w-72 rounded-md"
        muted
        controls
      />
    );
  }
  if (kind === "audio" && content) {
    return <audio src={content} className="w-72" controls />;
  }

  return (
    <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">
      {resource?.text ||
        node.metadata?.content ||
        node.metadata?.prompt ||
        node.title ||
        t("canvas.references.empty")}
    </div>
  );
}
