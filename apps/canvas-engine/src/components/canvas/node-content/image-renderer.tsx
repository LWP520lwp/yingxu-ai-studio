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
  previewUrlFor,
  subscribeImagePreviews,
  getImagePreviewRevision,
} from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasNodeImage } from "@/types/canvas";

import { BatchFrame } from "./batch-frame";
import type { NodeContentRendererProps } from "./contracts";
import { expandedBatchCardPosition, primaryImageSlot } from "./slot-view-model";
import { ImageSlotStatus } from "./status-renderers";

const selectionBlue = "#2f80ff";

export function ImageNodeContent(props: NodeContentRendererProps) {
  if (!primaryImageSlot(props.node).content && !props.isBatchRoot)
    return <EmptyImageContent {...props} />;

  return (
    <ImageContent
      node={props.node}
      batchExpanded={props.batchExpanded}
      scale={props.scale}
      onToggleBatch={props.onToggleBatch}
      onSetBatchPrimary={props.onSetBatchPrimary}
      onDuplicateBatchImage={props.onDuplicateBatchImage}
      onDownloadBatchImage={props.onDownloadBatchImage}
      onRetryBatchImage={props.onRetryBatchImage}
      onDeleteBatchImage={props.onDeleteBatchImage}
      onViewBatchImage={props.onViewBatchImage}
    />
  );
}

export function EmptyImageContent({ theme }: NodeContentRendererProps) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3"
      style={{ color: theme.node.placeholder }}
    >
      <div
        className="flex size-14 items-center justify-center rounded-2xl"
        style={{ background: theme.toolbar.activeBg }}
      >
        <ImageIcon className="size-6 opacity-30" />
      </div>
      <span className="text-[10px] tracking-[0.18em] opacity-50">
        {t("canvas.node.emptyImage")}
      </span>
    </div>
  );
}

function ImageContent({
  node,
  batchExpanded,
  scale,
  onToggleBatch,
  onSetBatchPrimary,
  onDuplicateBatchImage,
  onDownloadBatchImage,
  onRetryBatchImage,
  onDeleteBatchImage,
  onViewBatchImage,
}: {
  node: CanvasNodeData;
  batchExpanded: boolean;
  scale: number;
  onToggleBatch?: () => void;
  onSetBatchPrimary?: (imageId: string) => void;
  onDuplicateBatchImage?: (imageId: string) => void;
  onDownloadBatchImage?: (imageId: string) => void;
  onRetryBatchImage?: (imageId: string) => void;
  onDeleteBatchImage?: (imageId: string) => void;
  onViewBatchImage?: (imageId: string) => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
  const images = node.metadata?.images || [];
  const batchCount = images.length;
  const isBatchRoot = batchCount > 1;
  const { image: primaryImage, content: primaryContent } =
    primaryImageSlot(node);
  const primaryImageId = primaryImage?.id;
  const primaryPreviewUrl = previewUrlFor(
    primaryImage?.storageKey || node.metadata?.storageKey,
  );
  const primarySource = primaryContent
    ? pickImageSource({
        previewUrl: primaryPreviewUrl,
        originalUrl: primaryContent,
        naturalWidth: primaryImage?.naturalWidth || node.metadata?.naturalWidth,
        naturalHeight:
          primaryImage?.naturalHeight || node.metadata?.naturalHeight,
        renderedWidth: node.width,
        renderedHeight: node.height,
        scale,
      })
    : undefined;

  return (
    <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded}>
      {batchExpanded
        ? images
            .filter((image) => image.id !== primaryImageId)
            .map((image, index) => (
              <ExpandedImageCard
                key={image.id}
                node={node}
                image={image}
                index={index}
                scale={scale}
                onView={() => onViewBatchImage?.(image.id)}
                onSetPrimary={() => onSetBatchPrimary?.(image.id)}
                onDuplicate={() => onDuplicateBatchImage?.(image.id)}
                onDownload={() => onDownloadBatchImage?.(image.id)}
                onRetry={() => onRetryBatchImage?.(image.id)}
                onDelete={() => onDeleteBatchImage?.(image.id)}
              />
            ))
        : null}
      <div className="h-full w-full overflow-hidden rounded-3xl">
        {primaryContent ? (
          <img
            src={primarySource}
            alt={node.title}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
          />
        ) : (
          <ImageSlotStatus image={primaryImage} />
        )}
      </div>
      {primaryImage?.status === "error" ? (
        <BatchImageFailureActions
          placement="left"
          onRetry={() => onRetryBatchImage?.(primaryImage.id)}
          onDelete={() => onDeleteBatchImage?.(primaryImage.id)}
        />
      ) : null}
      {primaryImage?.content ? (
        <button
          type="button"
          className="pointer-events-none absolute left-2.5 top-2.5 z-30 flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium opacity-0 shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02] focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/node:pointer-events-auto group-hover/node:opacity-100"
          style={{
            background: theme.toolbar.panel,
            borderColor: theme.toolbar.border,
            color: theme.toolbar.activeText,
          }}
          title={t("common.download")}
          aria-label={t("common.download")}
          onClick={(event) => {
            event.stopPropagation();
            onDownloadBatchImage?.(primaryImage.id);
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Download className="size-3" />
          {t("common.download")}
        </button>
      ) : null}
      {isBatchRoot ? (
        <button
          type="button"
          className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(28,25,23,.16)] backdrop-blur-md transition hover:scale-[1.02]"
          style={{
            background: theme.toolbar.panel,
            borderColor: theme.toolbar.border,
            color: theme.toolbar.activeText,
          }}
          aria-label={
            batchExpanded
              ? t("canvas.node.batchExpanded")
              : t("canvas.node.batchCollapsed")
          }
          onClick={(event) => {
            event.stopPropagation();
            onToggleBatch?.();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="leading-none">
            {t("canvas.controls.images", { count: batchCount })}
          </span>
          <ChevronRight
            className={`size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}`}
          />
        </button>
      ) : null}
    </BatchFrame>
  );
}

function ExpandedImageCard({
  node,
  image,
  index,
  scale,
  onView,
  onSetPrimary,
  onDuplicate,
  onDownload,
  onRetry,
  onDelete,
}: {
  node: CanvasNodeData;
  image: CanvasNodeImage;
  index: number;
  scale: number;
  onView: () => void;
  onSetPrimary: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
  const count = node.metadata?.images?.length || 0;
  const { x, y } = expandedBatchCardPosition(
    index,
    count,
    node.width,
    node.height,
  );
  const source = image.content
    ? pickImageSource({
        previewUrl: previewUrlFor(image.storageKey),
        originalUrl: image.content,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        renderedWidth: node.width,
        renderedHeight: node.height,
        scale,
      })
    : undefined;

  return (
    <div
      className={`absolute z-20 overflow-hidden rounded-3xl ${image.content ? "" : "border shadow-[0_18px_50px_rgba(28,25,23,.18)]"}`}
      style={
        {
          left: x,
          top: y,
          width: node.width,
          height: node.height,
          background: "transparent",
          borderColor: theme.node.stroke,
          "--batch-from-x": `${-x}px`,
          "--batch-from-y": `${-y}px`,
          "--batch-from-rotate": `${4 + index * 2}deg`,
          animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`,
        } as React.CSSProperties
      }
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        if (
          !image.content ||
          (event.target instanceof Element && event.target.closest("button"))
        )
          return;
        event.stopPropagation();
        onView();
      }}
    >
      {image.content ? (
        <img
          src={source}
          alt={node.title}
          draggable={false}
          className="pointer-events-none h-full w-full select-none object-contain"
        />
      ) : (
        <ImageSlotStatus image={image} />
      )}
      {image.content ? (
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/node:pointer-events-auto group-hover/node:opacity-100 group-focus-within/node:pointer-events-auto group-focus-within/node:opacity-100">
          <ImageActionButton title={t("common.download")} onClick={onDownload}>
            <Download className="size-3 shrink-0" />
            <span className="truncate">{t("common.download")}</span>
          </ImageActionButton>
          <ImageActionButton
            title={t("canvas.node.createCopy")}
            onClick={onDuplicate}
          >
            <Copy className="size-3 shrink-0" />
            <span className="truncate">{t("canvas.node.createCopy")}</span>
          </ImageActionButton>
          <ImageActionButton
            title={t("canvas.node.setPrimary")}
            onClick={onSetPrimary}
          >
            <Star
              className="size-3 shrink-0"
              style={{ color: selectionBlue }}
            />
            <span className="truncate">{t("canvas.node.setPrimary")}</span>
          </ImageActionButton>
        </div>
      ) : null}
      {image.status === "error" ? (
        <BatchImageFailureActions
          placement="right"
          onRetry={onRetry}
          onDelete={onDelete}
        />
      ) : null}
    </div>
  );
}

function ImageActionButton({
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
      style={{
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.activeText,
      }}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  );
}

function BatchImageFailureActions({
  placement,
  onRetry,
  onDelete,
}: {
  placement: "left" | "right";
  onRetry: () => void;
  onDelete: () => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  return (
    <div
      className={`absolute top-3 z-30 flex items-center gap-1.5 ${placement === "left" ? "left-3" : "right-3"}`}
    >
      <button
        type="button"
        className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02]"
        style={{
          background: theme.toolbar.panel,
          borderColor: theme.toolbar.border,
          color: theme.node.text,
        }}
        onClick={(event) => {
          event.stopPropagation();
          onRetry();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <RefreshCw className="size-3.5" />
        {t("canvas.node.retry")}
      </button>
      <button
        type="button"
        className="grid size-8 place-items-center rounded-lg border shadow-sm transition hover:scale-[1.02]"
        style={{
          background: theme.toolbar.panel,
          borderColor: theme.toolbar.border,
          color: theme.node.text,
        }}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={t("common.delete")}
        title={t("common.delete")}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

export function ImageInfoBar({ node }: { node: CanvasNodeData }) {
  const width = Math.round(node.metadata?.naturalWidth || node.width);
  const height = Math.round(node.metadata?.naturalHeight || node.height);
  const size = formatBytes(node.metadata?.bytes || 0);
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
      <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
        {width} x {height}
        {size ? ` · ${size}` : ""}
      </span>
    </div>
  );
}
