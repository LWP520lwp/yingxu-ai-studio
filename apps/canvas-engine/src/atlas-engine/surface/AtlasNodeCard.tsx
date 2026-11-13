import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ChevronRight,
  Copy,
  Download,
  Group,
  Image as ImageIcon,
  Music2,
  RefreshCw,
  Star,
  Trash2,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { createAtlasNodeContext } from "@/atlas-engine/plugins/node-context";
import { getAtlasNodeDefinition as getNodeDefinition } from "@/atlas-engine/model/node-registry";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { pickImageSource } from "@/lib/image-thumbnail";
import {
  getImagePreviewRevision,
  previewUrlFor,
  subscribeImagePreviews,
} from "@/services/image-storage";
import { CanvasNodeType } from "@/types/canvas";
import { useThemeStore } from "@/stores/use-theme-store";
import {
  deriveAtlasNodeCardState,
  atlasPrimaryImage,
  atlasPrimaryText,
  resolveAtlasResize,
} from "./atlas-node-card-model";
import type {
  AtlasNodeCardProps,
  AtlasResizeCorner,
} from "./atlas-node-card-contracts";

const minimumNodeSize = { width: 96, height: 80 };

export function AtlasNodeCard(props: AtlasNodeCardProps) {
  const {
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    referenceSelectionState,
    showPanel,
    panelWidth = 600,
    showImageInfo,
    pluginHost,
    registryVersion,
    renderPanel,
    renderNodeContent,
    groupChildCount = 0,
    isGroupDropTarget = false,
    batchExpanded = false,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResizeStart,
    onResize,
    onResizeEnd,
    onContentChange,
    onTitleChange,
    onToggleBatch,
    onSetBatchPrimary,
    onDuplicateBatchImage,
    onDownloadBatchImage,
    onRetryBatchImage,
    onDeleteBatchImage,
    onRetry,
    onViewImage,
    onSelectReference,
    onContextMenu,
  } = props;
  const themeName = useThemeStore((state) => state.theme);
  const theme = canvasThemes[themeName];
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title || "");
  const [editingText, setEditingText] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);

  const definition = getNodeDefinition(data.type);
  const pluginContext = useMemo(
    () =>
      pluginHost
        ? createAtlasNodeContext(pluginHost, data, theme, scale, isSelected)
        : null,
    [data, isSelected, pluginHost, registryVersion, scale, theme],
  );
  const policy = definition
    ? {
        hasSourceHandle: definition.hasSourceHandle,
        transparentBackground: definition.transparentBackground,
        interactionToggle: definition.interactionToggle,
        forceInteractive: definition.forceInteractive,
        keepAspectRatio: definition.keepAspectRatio,
      }
    : undefined;
  const view = deriveAtlasNodeCardState({
    node: data,
    policy,
    selected: isSelected,
    focusRelated: isFocusRelated,
    connectionTarget: isConnectionTarget,
    connecting: isConnecting,
    hovered,
    editingTitle,
    groupDropTarget: isGroupDropTarget,
    referenceMode: referenceSelectionState,
    showImageInfo,
  });
  const primaryImage = atlasPrimaryImage(data);
  const primaryText = atlasPrimaryText(data);
  const imageContent =
    primaryImage?.content ||
    (data.type === CanvasNodeType.Image ? data.metadata?.content : undefined);
  const textContent = primaryText?.content ?? data.metadata?.content ?? "";
  const foreground = view.isActive
    ? theme.node.activeStroke
    : isRelated
      ? theme.node.muted
      : theme.node.stroke;
  const contentBackground =
    view.isGroup ||
    view.hasImage ||
    view.hasVideo ||
    view.hasAudio ||
    view.transparentBackground
      ? "transparent"
      : theme.node.fill;

  useEffect(() => setTitleDraft(data.title || ""), [data.id, data.title]);
  useEffect(() => {
    if (editingTitle) {
      titleInput.current?.focus();
      titleInput.current?.select();
    }
  }, [editingTitle]);
  useEffect(() => {
    if (editingText) textInput.current?.focus();
  }, [editingText]);
  useEffect(() => {
    if (!editingText && !editingTitle) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        textInput.current?.contains(target) ||
        titleInput.current?.contains(target)
      )
        return;
      if (editingText) setEditingText(false);
      if (editingTitle) commitTitle();
    };
    window.addEventListener("pointerdown", dismiss, true);
    return () => window.removeEventListener("pointerdown", dismiss, true);
  }, [
    editingText,
    editingTitle,
    titleDraft,
    data.title,
    data.id,
    onTitleChange,
    t,
  ]);

  function commitTitle() {
    const title =
      titleDraft.trim().slice(0, 64) || data.title || t("canvas.node.untitled");
    setTitleDraft(title);
    setEditingTitle(false);
    if (title !== data.title) onTitleChange(data.id, title);
  }

  function startResize(event: PointerEvent, corner: AtlasResizeCorner) {
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    const position = { ...data.position };
    const size = { width: data.width, height: data.height };
    const ratio =
      (data.metadata?.naturalWidth || data.width) /
      Math.max(1, data.metadata?.naturalHeight || data.height);
    onResizeStart(data.id);
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const result = resolveAtlasResize({
        corner,
        start,
        pointer: { x: next.clientX, y: next.clientY },
        position,
        size,
        scale,
        keepRatio: view.keepAspectRatio,
        ratio,
      });
      onResize(
        data.id,
        Math.max(minimumNodeSize.width, result.width),
        Math.max(minimumNodeSize.height, result.height),
        result.position,
      );
    };
    const finish = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      onResizeEnd(data.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function openNode(event: MouseEvent<HTMLElement>) {
    if (referenceSelectionState) return;
    if (pluginContext && definition?.onDoubleClick?.(pluginContext)) {
      event.stopPropagation();
      return;
    }
    if (data.type === CanvasNodeType.Image && imageContent) {
      event.stopPropagation();
      onViewImage?.(data);
    } else if (data.type === CanvasNodeType.Text) {
      event.stopPropagation();
      setEditingText(true);
    }
  }

  const pluginContent =
    definition?.Content && pluginContext ? (
      <definition.Content ctx={pluginContext} />
    ) : null;
  let content: ReactNode;
  if (data.type === CanvasNodeType.Config) {
    content = renderNodeContent?.(data) ?? (
      <EmptyState
        icon={<ImageIcon className="size-6 opacity-35" />}
        label={t("canvas.node.emptyImage")}
        theme={theme}
      />
    );
  } else if (pluginContent) {
    content = pluginContent;
  } else if (data.type === CanvasNodeType.Text) {
    content = (
      <TextContent
        nodeId={data.id}
        value={textContent}
        editing={editingText}
        primaryText={primaryText}
        batchCount={data.metadata?.texts?.length ?? 0}
        textItems={data.metadata?.texts ?? []}
        expanded={batchExpanded}
        theme={theme}
        inputRef={textInput}
        onChange={(value) => onContentChange(data.id, value)}
        onStop={() => setEditingText(false)}
        onRetry={() => onRetry?.(data)}
        onToggle={() => onToggleBatch?.(data.id)}
        onPromote={(id) => onSetBatchPrimary?.(data.id, id)}
      />
    );
  } else if (data.type === CanvasNodeType.Image) {
    content = (
      <ImageContent
        node={data}
        primary={primaryImage}
        src={imageContent}
        expanded={batchExpanded}
        scale={scale}
        theme={theme}
        onToggle={() => onToggleBatch?.(data.id)}
        onPromote={(id) => onSetBatchPrimary?.(data.id, id)}
        onDuplicate={(id) => onDuplicateBatchImage?.(data, id)}
        onDownload={(id) => onDownloadBatchImage?.(data, id)}
        onRetry={(id) => onRetryBatchImage?.(data, id)}
        onDelete={(id) => onDeleteBatchImage?.(data.id, id)}
        onView={(id) => onViewImage?.(data, id)}
        onGenerateRetry={() => onRetry?.(data)}
      />
    );
  } else if (data.type === CanvasNodeType.Video) {
    content = data.metadata?.content ? (
      <video
        src={data.metadata.content}
        controls
        className="h-full w-full rounded-lg bg-black object-contain"
        data-canvas-video={data.id}
        data-canvas-no-zoom
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      />
    ) : (
      <EmptyState
        icon={<Video className="size-7 opacity-35" />}
        label={t("canvas.node.emptyVideo")}
        theme={theme}
      />
    );
  } else if (data.type === CanvasNodeType.Audio) {
    content = data.metadata?.content ? (
      <div
        className="flex h-full w-full flex-col justify-center gap-3 px-4"
        style={{ background: theme.node.fill, color: theme.node.text }}
      >
        <div className="flex items-center gap-2 text-sm opacity-70">
          <Music2 className="size-4" />
          {t("canvas.node.audio")}
        </div>
        <audio
          src={data.metadata.content}
          controls
          className="w-full"
          data-canvas-no-zoom
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        />
      </div>
    ) : (
      <EmptyState
        icon={<Music2 className="size-7 opacity-35" />}
        label={t("canvas.node.emptyAudio")}
        theme={theme}
      />
    );
  } else if (data.type === CanvasNodeType.Group) {
    content = (
      <div
        className="flex h-full w-full items-start gap-2 p-3 text-xs"
        style={{ color: theme.node.text }}
      >
        <Group
          className="size-3.5 shrink-0"
          style={{ color: theme.node.muted }}
        />
        <span className="truncate">{data.title || t("canvas.node.group")}</span>
        <span className="shrink-0 opacity-65">
          {t("canvas.node.nodeCount", { count: groupChildCount })}
        </span>
      </div>
    );
  } else {
    content = pluginContext ? (
      <EmptyState
        icon={<ImageIcon className="size-6 opacity-35" />}
        label={t("canvas.node.pluginMissing")}
        theme={theme}
      />
    ) : (
      <EmptyState
        icon={<ImageIcon className="size-6 opacity-35" />}
        label={data.metadata?.content || t("canvas.node.editText")}
        theme={theme}
      />
    );
  }

  return (
    <article
      data-node-id={data.id}
      className="atlas-node-card group/node absolute flex select-none flex-col"
      style={{
        zIndex: view.isGroup ? 5 : isSelected ? 50 : 10,
        transform: `translate(${data.position.x}px, ${data.position.y}px)`,
        width: data.width,
        height: data.height,
        contain: "layout style",
      }}
      onPointerEnter={() => {
        setHovered(true);
        onHoverStart(data.id);
      }}
      onPointerLeave={() => {
        setHovered(false);
        onHoverEnd(data.id);
      }}
      onMouseDownCapture={(event) => {
        if (!referenceSelectionState) onSelectCapture?.(event, data.id);
      }}
      onContextMenu={(event) => {
        if (referenceSelectionState) event.preventDefault();
        else onContextMenu(event, data.id);
      }}
    >
      {view.showTitle ? (
        <div
          className="absolute left-2 top-[-26px] z-[65] max-w-[calc(100%-16px)]"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {editingTitle ? (
            <input
              ref={titleInput}
              value={titleDraft}
              maxLength={64}
              className="h-6 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
              style={{ borderColor: theme.node.muted, color: theme.node.text }}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTitle();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setTitleDraft(data.title || "");
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="block max-w-full truncate border-b border-dashed border-transparent py-0.5 text-left text-xs font-medium opacity-80 hover:border-current hover:opacity-100"
              style={{ color: theme.node.text }}
              title={t("canvas.node.renameHint")}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setEditingTitle(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "F2" || event.key === "Enter") {
                  event.preventDefault();
                  setEditingTitle(true);
                }
              }}
            >
              {data.title || t("canvas.node.untitled")}
            </button>
          )}
        </div>
      ) : null}
      <section
        className="relative h-full w-full overflow-visible border"
        style={{
          borderRadius: 8,
          background: contentBackground,
          borderColor: view.isGroup
            ? isGroupDropTarget || view.isActive
              ? theme.node.activeStroke
              : theme.node.stroke
            : view.hasImage && !view.isActive && !isRelated
              ? "transparent"
              : foreground,
          borderStyle: view.isGroup ? "dashed" : "solid",
          boxShadow: view.highlightGroupDropTarget
            ? `0 0 0 2px ${theme.node.activeStroke}55`
            : view.isActive
              ? `0 0 0 1px ${theme.node.activeStroke}44`
              : isRelated
                ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)`
                : undefined,
        }}
        onMouseDown={(event) => {
          if (referenceSelectionState) {
            if (event.button === 0 && referenceSelectionState === "available") {
              event.stopPropagation();
              onSelectReference?.(data.id);
            }
            return;
          }
          if (event.button === 0) onMouseDown(event, data.id);
        }}
        onDoubleClick={openNode}
        onWheelCapture={(event) => {
          if (editingText && event.target instanceof HTMLTextAreaElement)
            event.stopPropagation();
        }}
      >
        <div
          className={`relative flex h-full w-full items-center justify-center ${view.isBatch ? "overflow-visible" : "overflow-hidden"}`}
          style={{
            background: contentBackground,
            pointerEvents: view.contentInteractive ? undefined : "none",
          }}
        >
          {content}
        </div>
        {view.showImageInfo && imageContent ? <ImageInfo node={data} /> : null}
        {view.showFooterFade ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
            style={{
              background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)`,
            }}
          />
        ) : null}
        {view.showReferenceOverlay && referenceSelectionState ? (
          <div
            className="pointer-events-none absolute inset-0 z-[60] grid place-items-center rounded-[inherit]"
            style={{
              background: `color-mix(in srgb, ${theme.canvas.background} ${referenceSelectionState === "target" ? 78 : referenceSelectionState === "disabled" ? 60 : 34}%, transparent)`,
              boxShadow:
                referenceSelectionState === "available"
                  ? `inset 0 0 0 2px ${theme.node.activeStroke}`
                  : undefined,
            }}
          >
            {referenceSelectionState !== "disabled" ? (
              <span
                className="rounded px-3 py-2 text-sm font-medium shadow-sm"
                style={{
                  background: theme.toolbar.panel,
                  color: theme.node.text,
                }}
              >
                {t(
                  referenceSelectionState === "target"
                    ? "canvas.references.selecting"
                    : "canvas.references.choose",
                )}
              </span>
            ) : null}
          </div>
        ) : null}
        {!referenceSelectionState
          ? (
              [
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
              ] as AtlasResizeCorner[]
            ).map((corner) => (
              <ResizeAnchor
                key={corner}
                corner={corner}
                onResize={startResize}
              />
            ))
          : null}
      </section>
      {view.showConnectionHandles ? (
        <ConnectionPort
          side="left"
          active={view.connectionHandlesVisible}
          theme={theme}
          onStart={(event) => onConnectStart(event, data.id, "target")}
        />
      ) : null}
      {view.showSourceHandle ? (
        <ConnectionPort
          side="right"
          active={view.connectionHandlesVisible}
          theme={theme}
          onStart={(event) => onConnectStart(event, data.id, "source")}
        />
      ) : null}
      {showPanel && !view.isGroup && renderPanel ? (
        <div
          className="absolute left-1/2 top-full z-[70] pt-4"
          style={{
            width: panelWidth,
            transform: `translateX(-50%) scale(${1 / Math.max(scale, 0.1)})`,
            transformOrigin: "top center",
          }}
          data-node-panel={data.id}
        >
          {renderPanel(data)}
        </div>
      ) : null}
    </article>
  );
}

function TextContent(props: {
  nodeId: string;
  value: string;
  editing: boolean;
  primaryText?: { id: string; content: string; status: string };
  batchCount: number;
  expanded: boolean;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  textItems: NonNullable<AtlasNodeCardProps["data"]["metadata"]>["texts"];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onToggle: () => void;
  onPromote: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-lg"
      style={{ color: props.theme.node.text }}
    >
      {props.editing ? (
        <textarea
          ref={props.inputRef}
          className="thin-scrollbar h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words bg-transparent p-4 font-mono text-sm leading-6 outline-none select-text"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onBlur={props.onStop}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onStop();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        />
      ) : props.value ? (
        <div
          className="thin-scrollbar h-full w-full overflow-y-auto whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6"
          onWheel={(event) => event.stopPropagation()}
        >
          {props.value}
        </div>
      ) : props.primaryText?.status === "loading" ? (
        <Status label={t("canvas.node.generating")} />
      ) : props.primaryText?.status === "error" ? (
        <Status
          label={t("canvas.node.generationFailed")}
          onRetry={props.onRetry}
        />
      ) : (
        <div
          className="p-4 font-mono"
          style={{ color: props.theme.node.placeholder }}
        >
          {t("canvas.node.editText")}
        </div>
      )}
      {props.batchCount > 1 ? (
        <>
          {props.expanded ? (
            <div className="absolute inset-x-2 bottom-2 z-20 flex gap-2 overflow-x-auto">
              {props.textItems
                ?.filter((item) => item.id !== props.primaryText?.id)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="max-w-[45%] truncate rounded border px-2 py-1 text-[10px] shadow"
                    style={{
                      background: props.theme.toolbar.panel,
                      borderColor: props.theme.toolbar.border,
                      color: props.theme.node.text,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onPromote(item.id);
                    }}
                  >
                    {item.content || t("canvas.node.editText")}
                  </button>
                ))}
            </div>
          ) : null}
          <button
            type="button"
            className="absolute right-2 top-2 z-30 flex h-7 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold shadow backdrop-blur"
            style={{
              background: props.theme.toolbar.panel,
              borderColor: props.theme.toolbar.border,
              color: props.theme.toolbar.activeText,
            }}
            aria-expanded={props.expanded}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggle();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span>
              {t("canvas.controls.texts", { count: props.batchCount })}
            </span>
            <ChevronRight
              className={`size-3 transition-transform ${props.expanded ? "rotate-90" : ""}`}
            />
          </button>
        </>
      ) : null}
    </div>
  );
}

function ImageContent(props: {
  node: AtlasNodeCardProps["data"];
  primary?: ReturnType<typeof atlasPrimaryImage>;
  src?: string;
  expanded: boolean;
  scale: number;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  onToggle: () => void;
  onPromote: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDownload: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onView: (id: string) => void;
  onGenerateRetry: () => void;
}) {
  const { t } = useTranslation();
  const items = props.node.metadata?.images ?? [];
  const content = props.src;
  const source = content
    ? pickImageSource({
        previewUrl: previewUrlFor(
          props.primary?.storageKey || props.node.metadata?.storageKey,
        ),
        originalUrl: content,
        naturalWidth:
          props.primary?.naturalWidth || props.node.metadata?.naturalWidth,
        naturalHeight:
          props.primary?.naturalHeight || props.node.metadata?.naturalHeight,
        renderedWidth: props.node.width,
        renderedHeight: props.node.height,
        scale: props.scale,
      })
    : undefined;
  if (!content && props.primary?.status === "error")
    return (
      <Status
        label={props.primary.errorDetails || t("canvas.node.generationFailed")}
        onRetry={props.onGenerateRetry}
      />
    );
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      {source ? (
        <img
          src={source}
          alt={props.node.title}
          draggable={false}
          className={`h-full w-full select-none ${props.node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
        />
      ) : (
        <EmptyState
          icon={<ImageIcon className="size-6 opacity-35" />}
          label={t("canvas.node.emptyImage")}
          theme={props.theme}
        />
      )}
      {items.length > 1 ? (
        <>
          {props.expanded ? (
            <div className="absolute inset-x-2 bottom-2 z-20 flex gap-2 overflow-x-auto">
              {items
                .filter((item) => item.id !== props.primary?.id)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="grid size-16 shrink-0 place-items-center overflow-hidden rounded border shadow"
                    style={{
                      background: props.theme.toolbar.panel,
                      borderColor: props.theme.toolbar.border,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onPromote(item.id);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      props.onView(item.id);
                    }}
                    title={t("canvas.node.setPrimary")}
                  >
                    {item.content ? (
                      <img
                        src={item.content}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="size-4 opacity-40" />
                    )}
                  </button>
                ))}
            </div>
          ) : null}
          <button
            type="button"
            className="absolute right-2 top-2 z-30 flex h-7 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold shadow backdrop-blur"
            style={{
              background: props.theme.toolbar.panel,
              borderColor: props.theme.toolbar.border,
              color: props.theme.toolbar.activeText,
            }}
            aria-expanded={props.expanded}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggle();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span>{t("canvas.controls.images", { count: items.length })}</span>
            <ChevronRight
              className={`size-3 transition-transform ${props.expanded ? "rotate-90" : ""}`}
            />
          </button>
        </>
      ) : null}
      {content && props.primary ? (
        <div className="absolute left-2 top-2 z-20 flex gap-1 opacity-0 transition-opacity group-hover/node:opacity-100 focus-within:opacity-100">
          <ImageAction
            label={t("common.download")}
            theme={props.theme}
            onClick={() => props.onDownload(props.primary!.id)}
          >
            <Download className="size-3" />
          </ImageAction>
          <ImageAction
            label={t("canvas.node.createCopy")}
            theme={props.theme}
            onClick={() => props.onDuplicate(props.primary!.id)}
          >
            <Copy className="size-3" />
          </ImageAction>
          <ImageAction
            label={t("canvas.node.setPrimary")}
            theme={props.theme}
            onClick={() => props.onPromote(props.primary!.id)}
          >
            <Star className="size-3" />
          </ImageAction>
        </div>
      ) : null}
      {props.primary?.status === "error" ? (
        <div className="absolute bottom-2 left-2 z-20 flex gap-1">
          <ImageAction
            label={t("canvas.node.retry")}
            theme={props.theme}
            onClick={() => props.onRetry(props.primary!.id)}
          >
            <RefreshCw className="size-3" />
          </ImageAction>
          <ImageAction
            label={t("common.delete")}
            theme={props.theme}
            onClick={() => props.onDelete(props.primary!.id)}
          >
            <Trash2 className="size-3" />
          </ImageAction>
        </div>
      ) : null}
    </div>
  );
}

function ImageAction({
  label,
  theme,
  onClick,
  children,
}: {
  label: string;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded border shadow-sm backdrop-blur"
      style={{
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.node.text,
      }}
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

function Status({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-3 text-center text-xs opacity-75">
      <span className="max-h-[70%] overflow-auto whitespace-pre-wrap">
        {label}
      </span>
      {onRetry ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border px-2 py-1"
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <RefreshCw className="size-3" />
          <span>{"重试"}</span>
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({
  icon,
  label,
  theme,
}: {
  icon: ReactNode;
  label: string;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
}) {
  return (
    <div
      className="grid h-full w-full content-center justify-items-center gap-3 px-3 text-center text-sm"
      style={{ color: theme.node.placeholder }}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </div>
  );
}

function ImageInfo({ node }: { node: AtlasNodeCardProps["data"] }) {
  const width = Math.round(node.metadata?.naturalWidth || node.width);
  const height = Math.round(node.metadata?.naturalHeight || node.height);
  const fileSize = formatBytes(
    node.metadata?.bytes ?? atlasPrimaryImage(node)?.bytes ?? 0,
  );
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
      <span className="max-w-full truncate rounded bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
        {width} × {height}
        {fileSize ? ` · ${fileSize}` : ""}
      </span>
    </div>
  );
}

function ResizeAnchor({
  corner,
  onResize,
}: {
  corner: AtlasResizeCorner;
  onResize: (event: PointerEvent, corner: AtlasResizeCorner) => void;
}) {
  const { t } = useTranslation();
  const labels: Record<AtlasResizeCorner, string> = {
    "top-left": t("canvas.node.resizeTopLeft"),
    "top-right": t("canvas.node.resizeTopRight"),
    "bottom-left": t("canvas.node.resizeBottomLeft"),
    "bottom-right": t("canvas.node.resizeBottomRight"),
  };
  const placement: Record<AtlasResizeCorner, string> = {
    "top-left": "left-[-9px] top-[-9px] cursor-nwse-resize",
    "top-right": "right-[-9px] top-[-9px] cursor-nesw-resize",
    "bottom-left": "bottom-[-9px] left-[-9px] cursor-nesw-resize",
    "bottom-right": "bottom-[-9px] right-[-9px] cursor-nwse-resize",
  };
  return (
    <button
      type="button"
      aria-label={labels[corner]}
      className={`absolute z-50 size-[18px] touch-none rounded-full border border-white/70 bg-teal-500/80 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/node:opacity-100 ${placement[corner]}`}
      onPointerDown={(event) => onResize(event, corner)}
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    />
  );
}

function ConnectionPort({
  side,
  active,
  theme,
  onStart,
}: {
  side: "left" | "right";
  active: boolean;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  onStart: (event: MouseEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-connection-port={side}
      aria-label={t(
        side === "left"
          ? "canvas.node.connectInput"
          : "canvas.node.connectOutput",
      )}
      className={`absolute top-1/2 z-30 flex size-9 -translate-y-1/2 items-center justify-center rounded-full transition-opacity ${side === "left" ? "-left-[18px]" : "-right-[18px]"} ${active ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
      onMouseDown={onStart}
    >
      <span
        className="size-3 rounded-full border-2 transition-transform hover:scale-125"
        style={{
          background: theme.node.panel,
          borderColor: theme.node.activeStroke,
        }}
      />
    </button>
  );
}
