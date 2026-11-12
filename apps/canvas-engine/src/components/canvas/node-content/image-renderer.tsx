import { useSyncExternalStore } from "react";
import {
  ChevronRight,
  Copy,
  Download,
  Image as ImageIcon,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { pickImageSource } from "@/lib/image-thumbnail";
import {
  getImagePreviewRevision,
  previewUrlFor,
  subscribeImagePreviews,
} from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasNodeImage } from "@/types/canvas";

import { BatchFrame } from "./batch-frame";
import type {
  NodeContentCommands,
  NodeContentRendererProps,
} from "./contracts";
import { BatchItemFrame } from "./batch-item-frame";
import { primaryImageSlot } from "./slot-view-model";
import { ImageSlotStatus } from "./status-renderers";

const accent = "#2f80ff";

type ImageCommands = Pick<
  NodeContentCommands,
  | "toggleImageBatch"
  | "setPrimaryImage"
  | "duplicateImage"
  | "downloadImage"
  | "retryImage"
  | "deleteImage"
  | "viewImage"
>;

export function ImageNodeContent(props: NodeContentRendererProps) {
  const selection = primaryImageSlot(props.node);
  if (!selection.content && !props.isBatchRoot) return <EmptyImageContent {...props} />;

  return (
    <ImageGallery
      node={props.node}
      scale={props.scale}
      expanded={props.batchExpanded}
      commands={props.commands}
    />
  );
}

export function EmptyImageContent({ theme }: NodeContentRendererProps) {
  const { t } = useTranslation();
  return (
    <div className="grid h-full w-full content-center justify-items-center gap-3" style={{ color: theme.node.placeholder }}>
      <span className="grid size-14 place-items-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}>
        <ImageIcon className="size-6 opacity-30" />
      </span>
      <span className="text-[10px] tracking-[0.18em] opacity-50">{t("canvas.node.emptyImage")}</span>
    </div>
  );
}

function ImageGallery({
  node,
  scale,
  expanded,
  commands,
}: {
  node: CanvasNodeData;
  scale: number;
  expanded: boolean;
  commands: ImageCommands;
}) {
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const items = node.metadata?.images ?? [];
  const { image: primary, content } = primaryImageSlot(node);
  const primaryId = primary?.id;
  const alternatives = expanded ? items.filter(({ id }) => id !== primaryId) : [];
  const source = content
    ? resolvePreview(node, primary, content, scale)
    : undefined;

  return (
    <BatchFrame batchCount={items.length} batchExpanded={expanded}>
      {alternatives.map((image, index) => (
        <GalleryItem
          key={image.id}
          image={image}
          node={node}
          index={index}
          scale={scale}
          onOpen={() => commands.viewImage?.(image.id)}
          onPromote={() => commands.setPrimaryImage?.(image.id)}
          onCopy={() => commands.duplicateImage?.(image.id)}
          onDownload={() => commands.downloadImage?.(image.id)}
          onRetry={() => commands.retryImage?.(image.id)}
          onRemove={() => commands.deleteImage?.(image.id)}
        />
      ))}

      <div className="absolute inset-0 overflow-hidden rounded-3xl">
        {content ? (
          <img
            src={source}
            alt={node.title}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            className={`block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
          />
        ) : <ImageSlotStatus image={primary} />}
      </div>

      {primary?.status === "error" ? (
        <FailureControls
          side="left"
          onRetry={() => commands.retryImage?.(primary.id)}
          onRemove={() => commands.deleteImage?.(primary.id)}
        />
      ) : null}

      {content && primary ? (
        <button
          type="button"
          className="absolute left-2.5 top-2.5 z-30 inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium opacity-0 shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02] focus-visible:opacity-100 group-hover/node:opacity-100"
          style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
          title={t("common.download")}
          aria-label={t("common.download")}
          onClick={(event) => { event.stopPropagation(); commands.downloadImage?.(primary.id); }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Download className="size-3" />{t("common.download")}
        </button>
      ) : null}

      {items.length > 1 ? (
        <button
          type="button"
          className="absolute right-2.5 top-2.5 z-30 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(28,25,23,.16)] backdrop-blur-md transition hover:scale-[1.02]"
          style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
          aria-label={expanded ? t("canvas.node.batchExpanded") : t("canvas.node.batchCollapsed")}
          aria-expanded={expanded}
          onClick={(event) => { event.stopPropagation(); commands.toggleImageBatch?.(); }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {t("canvas.controls.images", { count: items.length })}
          <ChevronRight className={`size-3.5 opacity-80 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      ) : null}
    </BatchFrame>
  );
}

function GalleryItem({
  image,
  node,
  index,
  scale,
  onOpen,
  onPromote,
  onCopy,
  onDownload,
  onRetry,
  onRemove,
}: {
  image: CanvasNodeImage;
  node: CanvasNodeData;
  index: number;
  scale: number;
  onOpen: () => void;
  onPromote: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const src = image.content ? resolvePreview(node, image, image.content, scale) : undefined;

  return (
    <BatchItemFrame
      node={node}
      index={index}
      count={node.metadata?.images?.length ?? 0}
      theme={theme}
      bare={Boolean(image.content)}
      onDoubleClick={(event) => {
        if (!image.content || (event.target instanceof Element && event.target.closest("button"))) return;
        event.stopPropagation();
        onOpen();
      }}
    >
      {src ? <img src={src} alt={node.title} draggable={false} className="pointer-events-none h-full w-full select-none object-contain" /> : <ImageSlotStatus image={image} />}
      {image.content ? (
        <div className="pointer-events-none absolute inset-x-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover/node:pointer-events-auto group-hover/node:opacity-100 group-focus-within/node:pointer-events-auto group-focus-within/node:opacity-100">
          <CardCommand title={t("common.download")} onClick={onDownload}><Download className="size-3 shrink-0" /><span className="truncate">{t("common.download")}</span></CardCommand>
          <CardCommand title={t("canvas.node.createCopy")} onClick={onCopy}><Copy className="size-3 shrink-0" /><span className="truncate">{t("canvas.node.createCopy")}</span></CardCommand>
          <CardCommand title={t("canvas.node.setPrimary")} onClick={onPromote}><Star className="size-3 shrink-0" style={{ color: accent }} /><span className="truncate">{t("canvas.node.setPrimary")}</span></CardCommand>
        </div>
      ) : null}
      {image.status === "error" ? <FailureControls side="right" onRetry={onRetry} onRemove={onRemove} /> : null}
    </BatchItemFrame>
  );
}

function resolvePreview(
  node: CanvasNodeData,
  image: CanvasNodeImage | undefined,
  originalUrl: string,
  scale: number,
) {
  return pickImageSource({
    previewUrl: previewUrlFor(image?.storageKey || node.metadata?.storageKey),
    originalUrl,
    naturalWidth: image?.naturalWidth || node.metadata?.naturalWidth,
    naturalHeight: image?.naturalHeight || node.metadata?.naturalHeight,
    renderedWidth: node.width,
    renderedHeight: node.height,
    scale,
  });
}

function CardCommand({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  return (
    <button
      type="button"
      className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]"
      style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
      title={title}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >{children}</button>
  );
}

function FailureControls({
  side,
  onRetry,
  onRemove,
}: {
  side: "left" | "right";
  onRetry: () => void;
  onRemove: () => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  return (
    <div className={`absolute top-3 z-30 flex items-center gap-1.5 ${side === "left" ? "left-3" : "right-3"}`}>
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02]"
        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
        onClick={(event) => { event.stopPropagation(); onRetry(); }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      ><RefreshCw className="size-3.5" />{t("canvas.node.retry")}</button>
      <button
        type="button"
        className="grid size-8 place-items-center rounded-lg border shadow-sm transition hover:scale-[1.02]"
        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
        onClick={(event) => { event.stopPropagation(); onRemove(); }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={t("common.delete")}
        title={t("common.delete")}
      ><Trash2 className="size-3.5" /></button>
    </div>
  );
}

export function ImageInfoBar({ node }: { node: CanvasNodeData }) {
  const dimensions = `${Math.round(node.metadata?.naturalWidth || node.width)} x ${Math.round(node.metadata?.naturalHeight || node.height)}`;
  const fileSize = formatBytes(node.metadata?.bytes ?? 0);
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
      <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
        {dimensions}{fileSize ? ` · ${fileSize}` : ""}
      </span>
    </div>
  );
}
