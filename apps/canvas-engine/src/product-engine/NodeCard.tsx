import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { CanvasConfigPanelOverlay } from "@/components/canvas/canvas-config-panel-overlay";
import { ImageInfoBar } from "@/components/canvas/node-content/image-renderer";
import { NodeContent } from "@/components/canvas/node-content/dispatcher";
import type { NodeContentCommands } from "@/components/canvas/node-content/contracts";
import type { ResizeCorner } from "@/lib/canvas/canvas-node-resize";
import { canvasNodeOpenAction, canvasNodePressAction, canvasNodeTitleKeyAction } from "@/lib/canvas/canvas-node-interaction";
import { buildCanvasNodeViewModel } from "@/components/canvas/node-content/canvas-node-view-model";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasNodeResize } from "@/components/canvas/use-canvas-node-resize";
import { useCanvasNodeTitleEditing } from "@/components/canvas/use-canvas-node-title-editing";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import { useThemeStore } from "@/stores/use-theme-store";
import { useTranslation } from "react-i18next";

const selectionColor = "#2f80ff";

export type ProductNodeCardProps = {
  data: CanvasNodeData;
  scale: number;
  isSelected: boolean;
  isRelated: boolean;
  isFocusRelated: boolean;
  isConnectionTarget: boolean;
  isConnecting: boolean;
  referenceSelectionState?: "target" | "disabled" | "available";
  showPanel: boolean;
  panelWidth?: number;
  showImageInfo: boolean;
  mentionReferences?: CanvasResourceReference[];
  pluginHost?: CanvasPluginHost;
  registryVersion?: number;
  renderPanel?: (node: CanvasNodeData) => ReactNode;
  renderNodeContent?: (node: CanvasNodeData) => ReactNode;
  groupChildCount?: number;
  isGroupDropTarget?: boolean;
  batchExpanded?: boolean;
  onMouseDown: (event: MouseEvent, nodeId: string) => void;
  onSelectCapture?: (event: MouseEvent, nodeId: string) => void;
  onHoverStart: (nodeId: string) => void;
  onHoverEnd: (nodeId: string) => void;
  onConnectStart: (event: MouseEvent, nodeId: string, handleType: "source" | "target") => void;
  onResizeStart: (nodeId: string) => void;
  onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
  onResizeEnd: (nodeId: string) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onTitleChange: (nodeId: string, title: string) => void;
  onToggleBatch?: (nodeId: string) => void;
  onSetBatchPrimary?: (nodeId: string, itemId: string) => void;
  onDuplicateBatchImage?: (node: CanvasNodeData, imageId: string) => void;
  onDownloadBatchImage?: (node: CanvasNodeData, imageId: string) => void;
  onRetryBatchImage?: (node: CanvasNodeData, imageId: string) => void;
  onDeleteBatchImage?: (nodeId: string, imageId: string) => void;
  onRetry?: (node: CanvasNodeData) => void;
  onViewImage?: (node: CanvasNodeData, imageId?: string) => void;
  onSelectReference?: (nodeId: string) => void;
  onContextMenu: (event: MouseEvent, nodeId: string) => void;
};

export function ProductNodeCard(props: ProductNodeCardProps) {
  const {
    data, scale, isSelected, isRelated, isFocusRelated, isConnectionTarget,
    isConnecting, referenceSelectionState, showPanel, panelWidth = 600,
    showImageInfo, mentionReferences = [], pluginHost, renderPanel,
    renderNodeContent, groupChildCount = 0, isGroupDropTarget = false,
    batchExpanded = false, onMouseDown, onSelectCapture, onHoverStart,
    onHoverEnd, onConnectStart, onResizeStart, onResize, onResizeEnd,
    onContentChange, onTitleChange, onToggleBatch, onSetBatchPrimary,
    onDuplicateBatchImage, onDownloadBatchImage, onRetryBatchImage,
    onDeleteBatchImage, onRetry, onViewImage, onSelectReference, onContextMenu,
  } = props;
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const definition = getNodeDefinition(data.type);
  const title = useCanvasNodeTitleEditing({ nodeId: data.id, title: data.title || "", onTitleChange });
  const pluginContext = useMemo<CanvasNodeContext | null>(() =>
    pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null,
  [data, isSelected, pluginHost, scale, theme]);
  const view = buildCanvasNodeViewModel({
    node: data,
    definition,
    isSelected,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    isHovered: hovered,
    isEditingTitle: title.isEditing,
    isGroupDropTarget,
    hasReferenceSelection: Boolean(referenceSelectionState),
    referenceSelectionAvailable: referenceSelectionState === "available",
    showImageInfo,
  });
  const resize = useCanvasNodeResize({
    node: data,
    scale,
    keepAspectRatio: view.keepAspectRatio,
    onResizeStart,
    onResize,
    onResizeEnd,
  });

  useEffect(() => {
    if (!editingContent) return;
    editorRef.current?.focus();
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && editorRef.current?.contains(event.target)) return;
      setEditingContent(false);
    };
    window.addEventListener("pointerdown", dismiss, true);
    return () => window.removeEventListener("pointerdown", dismiss, true);
  }, [editingContent]);

  const foreground = view.isActive ? selectionColor : isRelated ? theme.node.muted : theme.node.stroke;
  const contentBackground = view.isGroup || view.hasImageContent || view.hasVideoContent || view.transparentBackground
    ? "transparent"
    : theme.node.fill;
  const contentCommands = useMemo<NodeContentCommands>(() => ({
    updateText: (content) => onContentChange(data.id, content),
    stopTextEditing: () => setEditingContent(false),
    retryGeneration: onRetry ? () => onRetry(data) : undefined,
    toggleTextBatch: onToggleBatch ? () => onToggleBatch(data.id) : undefined,
    setPrimaryText: onSetBatchPrimary
      ? (itemId) => onSetBatchPrimary(data.id, itemId)
      : undefined,
    toggleImageBatch: onToggleBatch ? () => onToggleBatch(data.id) : undefined,
    setPrimaryImage: onSetBatchPrimary
      ? (itemId) => onSetBatchPrimary(data.id, itemId)
      : undefined,
    duplicateImage: onDuplicateBatchImage
      ? (imageId) => onDuplicateBatchImage(data, imageId)
      : undefined,
    downloadImage: onDownloadBatchImage
      ? (imageId) => onDownloadBatchImage(data, imageId)
      : undefined,
    retryImage: onRetryBatchImage
      ? (imageId) => onRetryBatchImage(data, imageId)
      : undefined,
    deleteImage: onDeleteBatchImage
      ? (imageId) => onDeleteBatchImage(data.id, imageId)
      : undefined,
    viewImage: onViewImage
      ? (imageId) => onViewImage(data, imageId)
      : undefined,
  }), [
    data,
    onContentChange,
    onDeleteBatchImage,
    onDownloadBatchImage,
    onDuplicateBatchImage,
    onRetry,
    onRetryBatchImage,
    onSetBatchPrimary,
    onToggleBatch,
    onViewImage,
  ]);

  const nodeContent = <NodeContent
    node={data}
    theme={theme}
    isEditingContent={editingContent}
    textareaRef={editorRef}
    isBatchRoot={view.isBatchRoot}
    batchCount={view.batchCount}
    batchExpanded={batchExpanded}
    scale={scale}
    renderNodeContent={renderNodeContent}
    pluginContext={pluginContext}
    mentionReferences={mentionReferences}
    commands={contentCommands}
    groupChildCount={groupChildCount}
  />;

  const openNode = (event: MouseEvent<HTMLDivElement>) => {
    const action = canvasNodeOpenAction({
      referenceSelection: referenceSelectionState,
      hasPluginHandler: Boolean(definition?.onDoubleClick && pluginContext),
      type: data.type,
      hasImageContent: view.hasImageContent,
    });
    if (action === "plugin") {
      if (pluginContext && definition?.onDoubleClick?.(pluginContext)) event.stopPropagation();
      return;
    }
    if (action === "image") {
      event.stopPropagation();
      onViewImage?.(data);
    } else if (action === "text") {
      event.stopPropagation();
      setEditingContent(true);
    }
  };

  return (
    <article
      data-node-id={data.id}
      className="canvas-atlas-node node-element group/node absolute flex select-none flex-col"
      style={{
        zIndex: view.isGroup ? 5 : isSelected ? 50 : 10,
        transform: `translate(${data.position.x}px, ${data.position.y}px)`,
        width: data.width,
        height: data.height,
        contain: "layout style",
      }}
      onPointerEnter={() => { setHovered(true); onHoverStart(data.id); }}
      onPointerLeave={() => { setHovered(false); onHoverEnd(data.id); }}
      onMouseDownCapture={(event) => { if (!referenceSelectionState) onSelectCapture?.(event, data.id); }}
      onContextMenu={(event) => {
        if (referenceSelectionState) event.preventDefault();
        else onContextMenu(event, data.id);
      }}
    >
      {view.showTitle ? <div className="absolute left-2 top-[-26px] z-[65] max-w-[calc(100%-16px)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        {title.isEditing ? <input
          ref={title.inputRef}
          value={title.draft}
          maxLength={64}
          className="h-6 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
          style={{ borderColor: theme.node.muted, color: theme.node.text }}
          onChange={(event) => title.setDraft(event.target.value)}
          onBlur={title.finish}
          onKeyDown={(event) => {
            const action = canvasNodeTitleKeyAction(event.key, event.nativeEvent.isComposing, event.keyCode);
            if (action === "none") return;
            event.preventDefault();
            action === "commit" ? title.finish() : title.cancel();
          }}
        /> : <button
          type="button"
          className="block max-w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left text-xs font-medium opacity-80 hover:border-current hover:opacity-100"
          style={{ color: theme.node.text }}
          title={t("canvas.node.renameHint")}
          onDoubleClick={(event) => { event.stopPropagation(); title.start(); }}
          onKeyDown={(event) => {
            if (event.key !== "F2" && event.key !== "Enter") return;
            event.preventDefault();
            title.start();
          }}
        >{data.title || t("canvas.node.untitled")}</button>}
      </div> : null}

      <section
        className="canvas-atlas-node__frame relative h-full w-full overflow-visible border"
        style={{
          borderRadius: 8,
          background: contentBackground,
          borderColor: view.isGroup ? (isGroupDropTarget || view.isActive ? selectionColor : theme.node.stroke)
            : view.hasImageContent && !view.isActive && !isRelated ? "transparent" : foreground,
          borderStyle: view.isGroup ? "dashed" : "solid",
          boxShadow: view.highlightGroupDropTarget ? `0 0 0 2px ${selectionColor}66, inset 0 0 0 999px ${selectionColor}10`
            : view.isActive ? `0 0 0 1px ${selectionColor}55`
              : isRelated ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)` : undefined,
        }}
        onMouseDown={(event) => {
          const action = canvasNodePressAction(event.button, referenceSelectionState);
          if (action === "drag") onMouseDown(event, data.id);
          if (action === "reference") {
            event.stopPropagation();
            onSelectReference?.(data.id);
          }
        }}
        onDoubleClick={openNode}
        onWheelCapture={(event) => {
          if (editingContent && event.target instanceof HTMLTextAreaElement) event.stopPropagation();
        }}
      >
        <div className={`relative flex h-full w-full items-center justify-center ${view.isBatchRoot ? "overflow-visible" : "overflow-hidden"}`} style={{ background: contentBackground, pointerEvents: view.contentInteractive ? undefined : "none" }}>
          {nodeContent}
        </div>
        {view.showImageInfo ? <ImageInfoBar node={data} /> : null}
        {view.showFooterFade ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}
        {view.showReferenceOverlay && referenceSelectionState ? <div className="pointer-events-none absolute inset-0 z-[60] grid place-items-center rounded-[inherit]" style={{ background: `color-mix(in srgb, ${theme.canvas.background} ${referenceSelectionState === "target" ? 78 : referenceSelectionState === "disabled" ? 60 : 34}%, transparent)`, boxShadow: referenceSelectionState === "available" ? `inset 0 0 0 2px ${selectionColor}` : undefined }}>
          {referenceSelectionState !== "disabled" ? <span className="rounded px-3 py-2 text-sm font-medium shadow-sm" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{t(referenceSelectionState === "target" ? "canvas.references.selecting" : "canvas.references.choose")}</span> : null}
        </div> : null}
        {!referenceSelectionState ? <>
          <ResizeGrip corner="top-left" onResize={resize} />
          <ResizeGrip corner="top-right" onResize={resize} />
          <ResizeGrip corner="bottom-left" onResize={resize} />
          <ResizeGrip corner="bottom-right" onResize={resize} />
        </> : null}
      </section>

      {view.showConnectionHandles ? <ConnectionPort side="left" active={view.connectionHandlesVisible} theme={theme} onStart={(event) => onConnectStart(event, data.id, "target")} /> : null}
      {view.showSourceHandle ? <ConnectionPort side="right" active={view.connectionHandlesVisible} theme={theme} onStart={(event) => onConnectStart(event, data.id, "source")} /> : null}

      {showPanel && !view.isGroup && renderPanel ? data.type === CanvasNodeType.Config ? <CanvasConfigPanelOverlay nodeId={data.id} scale={scale} width={panelWidth}>{renderPanel(data)}</CanvasConfigPanelOverlay> : <div
        className="absolute left-1/2 top-full z-[70] pt-4"
        style={{ width: panelWidth, transform: `translateX(-50%) scale(${1 / scale})`, transformOrigin: "top center" }}
        data-node-panel={data.id}
      >{renderPanel(data)}</div> : null}
    </article>
  );
}

function ResizeGrip({ corner, onResize }: { corner: ResizeCorner; onResize: (event: PointerEvent, corner: ResizeCorner) => void }) {
  const placement = {
    "top-left": "left-[-10px] top-[-10px] cursor-nwse-resize",
    "top-right": "right-[-10px] top-[-10px] cursor-nesw-resize",
    "bottom-left": "bottom-[-10px] left-[-10px] cursor-nesw-resize",
    "bottom-right": "bottom-[-10px] right-[-10px] cursor-nwse-resize",
  }[corner];
  return <button type="button" aria-label={`调整节点大小 ${corner}`} className={`absolute z-50 size-5 touch-none rounded-full border border-white/60 bg-teal-500/80 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/node:opacity-100 ${placement}`} onPointerDown={(event) => onResize(event, corner)} onMouseDown={(event) => { event.stopPropagation(); event.preventDefault(); }} />;
}

function ConnectionPort({ side, active, theme, onStart }: { side: "left" | "right"; active: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onStart: (event: MouseEvent) => void }) {
  return <button
    type="button"
    data-connection-port={side}
    aria-label={side === "left" ? "连接输入" : "连接输出"}
    className={`absolute top-1/2 z-30 flex size-9 -translate-y-1/2 items-center justify-center rounded-full transition-opacity ${side === "left" ? "-left-[18px]" : "-right-[18px]"} ${active ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
    onMouseDown={onStart}
  >
    <span className="size-3 rounded-full border-2 transition-transform hover:scale-125" style={{ background: theme.node.panel, borderColor: theme.node.activeStroke }} />
  </button>;
}
