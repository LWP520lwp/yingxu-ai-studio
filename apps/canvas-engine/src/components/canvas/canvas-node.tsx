import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { type ResizeCorner } from "@/lib/canvas/canvas-node-resize";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { NodeContent } from "@/components/canvas/node-content/dispatcher";
import { ImageInfoBar } from "@/components/canvas/node-content/image-renderer";
import { buildCanvasNodeViewModel } from "@/components/canvas/node-content/canvas-node-view-model";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import {
  canvasNodeOpenAction,
  canvasNodePressAction,
  canvasNodeTitleKeyAction,
} from "@/lib/canvas/canvas-node-interaction";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCanvasNodeResize } from "./use-canvas-node-resize";
import { useCanvasNodeTitleEditing } from "./use-canvas-node-title-editing";
import { CanvasConfigPanelOverlay } from "./canvas-config-panel-overlay";
import {
  CanvasNodeType,
  type CanvasNodeData,
  type Position,
} from "@/types/canvas";
import type {
  CanvasNodeContext,
  CanvasPluginHost,
} from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useTranslation } from "react-i18next";

const selectionBlue = "#2f80ff";

type CanvasNodeProps = {
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
  onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
  onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
  onHoverStart: (nodeId: string) => void;
  onHoverEnd: (nodeId: string) => void;
  onConnectStart: (
    event: React.MouseEvent,
    nodeId: string,
    handleType: "source" | "target",
  ) => void;
  onResizeStart: (nodeId: string) => void;
  onResize: (
    nodeId: string,
    width: number,
    height: number,
    position?: Position,
  ) => void;
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
  onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

export const CanvasNode = React.memo(function CanvasNode({
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
  mentionReferences = [],
  pluginHost,
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
}: CanvasNodeProps) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const definition = getNodeDefinition(data.type);
  const pluginContext = useMemo<CanvasNodeContext | null>(
    () =>
      pluginHost
        ? buildNodeContext(pluginHost, data, theme, scale, isSelected)
        : null,
    [pluginHost, data, theme, scale, isSelected],
  );
  const [isEditingContent, setIsEditingContent] = useState(false);
  const titleEditor = useCanvasNodeTitleEditing({
    nodeId: data.id,
    title: data.title || "",
    onTitleChange,
  });
  const { isEditing: isEditingTitle } = titleEditor;
  const view = buildCanvasNodeViewModel({
    node: data,
    definition,
    isSelected,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    isHovered: hovered,
    isEditingTitle,
    isGroupDropTarget,
    hasReferenceSelection: Boolean(referenceSelectionState),
    referenceSelectionAvailable: referenceSelectionState === "available",
    showImageInfo,
  });
  const {
    hasImageContent,
    hasVideoContent,
    hasAudioContent,
    isGroup,
    batchCount,
    isBatchRoot,
    contentInteractive,
    transparentBackground: transparentBg,
    isActive,
  } = view;
  const imageBorderColor = isActive
    ? selectionBlue
    : isRelated
      ? theme.node.muted
      : "transparent";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleWheel = (event: WheelEvent) => event.stopPropagation();
    textarea.addEventListener("wheel", handleWheel, { passive: false });
    return () => textarea.removeEventListener("wheel", handleWheel);
  }, [data.type, isEditingContent]);

  useEffect(() => {
    if (!isEditingContent) return;
    const textarea = textareaRef.current;
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [isEditingContent]);

  useEffect(() => {
    if (!isEditingContent) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (isEditingContent && textareaRef.current?.contains(target)) return;

      setIsEditingContent(false);
    };

    window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [isEditingContent]);

  const handleResizePointerDown = useCanvasNodeResize({
    node: data,
    scale,
    keepAspectRatio: view.keepAspectRatio,
    onResizeStart,
    onResize,
    onResizeEnd,
  });

  return (
    <div
      data-node-id={data.id}
      className={`canvas-atlas-node node-element group/node absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"} ${referenceSelectionState === "available" ? "cursor-pointer" : referenceSelectionState ? "cursor-not-allowed" : ""}`}
      style={{
        transform: `translate(${data.position.x}px, ${data.position.y}px)`,
        width: data.width,
        height: data.height,
        transition: "box-shadow 200ms ease",
        contain: "layout style",
      }}
      onMouseEnter={() => {
        setHovered(true);
        onHoverStart(data.id);
      }}
      onMouseLeave={() => {
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
      {view.showTitle && (
        <div
          className="absolute left-3 top-[-28px] z-[65] max-w-[calc(100%-24px)]"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {isEditingTitle ? (
            <input
              ref={titleEditor.inputRef}
              value={titleEditor.draft}
              maxLength={64}
              className="h-6 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
              style={{
                borderColor: theme.node.muted,
                color: theme.node.text,
              }}
              onChange={(event) => titleEditor.setDraft(event.target.value)}
              onBlur={titleEditor.finish}
              onKeyDown={(event) => {
                const action = canvasNodeTitleKeyAction(
                  event.key,
                  event.nativeEvent.isComposing,
                  event.keyCode,
                );
                if (action === "none") return;
                event.preventDefault();
                if (action === "commit") titleEditor.finish();
                else titleEditor.cancel();
              }}
            />
          ) : (
            <button
              type="button"
              className="block max-w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left text-xs font-medium opacity-75 transition hover:border-current hover:opacity-100"
              style={{ color: theme.node.text }}
              title={t("canvas.node.renameHint")}
              onDoubleClick={(event) => {
                event.stopPropagation();
                titleEditor.start();
              }}
              onKeyDown={(event) => {
                if (event.key === "F2" || event.key === "Enter") {
                  event.preventDefault();
                  titleEditor.start();
                }
              }}
            >
              {data.title || t("canvas.node.untitled")}
            </button>
          )}
        </div>
      )}

      <div
        className="canvas-atlas-node__frame relative h-full w-full overflow-visible rounded-3xl border-2"
        style={{
          background: isGroup
            ? "transparent"
            : hasImageContent || hasVideoContent || transparentBg
              ? "transparent"
              : theme.node.fill,
          borderColor: isGroup
            ? isGroupDropTarget || isActive
              ? selectionBlue
              : theme.node.stroke
            : hasImageContent
              ? imageBorderColor
              : isActive
                ? selectionBlue
                : isRelated
                  ? theme.node.muted
                  : transparentBg
                    ? "transparent"
                    : theme.node.stroke,
          borderStyle: isGroup ? "dashed" : "solid",
          boxShadow: view.highlightGroupDropTarget
            ? `0 0 0 2px ${selectionBlue}66, inset 0 0 0 999px ${selectionBlue}10`
            : isActive
              ? `0 0 0 1px ${selectionBlue}55`
              : isRelated
                ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)`
                : undefined,
        }}
        onMouseDown={(event) => {
          const action = canvasNodePressAction(
            event.button,
            referenceSelectionState,
          );
          if (action === "drag") onMouseDown(event, data.id);
          else if (action === "reference") {
            event.stopPropagation();
            onSelectReference?.(data.id);
          }
        }}
        onDoubleClick={(event) => {
          const action = canvasNodeOpenAction({
            referenceSelection: referenceSelectionState,
            hasPluginHandler: Boolean(
              definition?.onDoubleClick && pluginContext,
            ),
            type: data.type,
            hasImageContent,
          });
          if (action === "plugin") {
            if (pluginContext && definition?.onDoubleClick?.(pluginContext))
              event.stopPropagation();
          } else if (action !== "none") {
            event.stopPropagation();
            if (action === "image") onViewImage?.(data);
            else if (action === "text") setIsEditingContent(true);
          }
        }}
      >
        <div
          className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
          style={
            {
              background: isGroup
                ? "transparent"
                : hasImageContent || hasVideoContent || transparentBg
                  ? "transparent"
                  : theme.node.fill,
              pointerEvents: contentInteractive ? undefined : "none",
            } as React.CSSProperties
          }
        >
          <NodeContent
            node={data}
            theme={theme}
            isEditingContent={isEditingContent}
            textareaRef={textareaRef}
            isBatchRoot={isBatchRoot}
            batchCount={batchCount}
            batchExpanded={batchExpanded}
            scale={scale}
            renderNodeContent={renderNodeContent}
            pluginContext={pluginContext}
            mentionReferences={mentionReferences}
            onContentChange={onContentChange}
            onStopEditing={() => setIsEditingContent(false)}
            onRetry={onRetry}
            onToggleBatch={() => onToggleBatch?.(data.id)}
            onSetBatchPrimary={(itemId) => onSetBatchPrimary?.(data.id, itemId)}
            onDuplicateBatchImage={(imageId) =>
              onDuplicateBatchImage?.(data, imageId)
            }
            onDownloadBatchImage={(imageId) =>
              onDownloadBatchImage?.(data, imageId)
            }
            onRetryBatchImage={(imageId) => onRetryBatchImage?.(data, imageId)}
            onDeleteBatchImage={(imageId) =>
              onDeleteBatchImage?.(data.id, imageId)
            }
            onViewBatchImage={(imageId) => onViewImage?.(data, imageId)}
            groupChildCount={groupChildCount}
          />
        </div>

        {view.showImageInfo ? <ImageInfoBar node={data} /> : null}

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
                  ? `inset 0 0 0 2px ${selectionBlue}`
                  : undefined,
            }}
          >
            {referenceSelectionState !== "disabled" ? (
              <span
                className="rounded-lg px-3 py-2 text-sm font-medium shadow-sm"
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

        {!referenceSelectionState ? (
          <ResizeHandle
            corner="top-left"
            onPointerDown={handleResizePointerDown}
          />
        ) : null}
        {!referenceSelectionState ? (
          <ResizeHandle
            corner="top-right"
            onPointerDown={handleResizePointerDown}
          />
        ) : null}
        {!referenceSelectionState ? (
          <ResizeHandle
            corner="bottom-left"
            onPointerDown={handleResizePointerDown}
          />
        ) : null}
        {!referenceSelectionState ? (
          <ResizeHandle
            corner="bottom-right"
            onPointerDown={handleResizePointerDown}
          />
        ) : null}
      </div>

      {view.showConnectionHandles ? (
        <ConnectionHandleDot
          side="left"
          visible={view.connectionHandlesVisible}
          onMouseDown={(event) => onConnectStart(event, data.id, "target")}
        />
      ) : null}
      {view.showSourceHandle ? (
        <ConnectionHandleDot
          side="right"
          visible={view.connectionHandlesVisible}
          onMouseDown={(event) => onConnectStart(event, data.id, "source")}
        />
      ) : null}

      {/* Counter-scale the panel so its on-screen size stays constant while the canvas zooms. */}
      {showPanel && !isGroup && renderPanel ? (
        data.type === CanvasNodeType.Config ? (
          <CanvasConfigPanelOverlay
            nodeId={data.id}
            scale={scale}
            width={panelWidth}
          >
            {renderPanel(data)}
          </CanvasConfigPanelOverlay>
        ) : (
          <div
            className="absolute left-1/2 top-full z-[70] pt-4"
            style={{
              width: panelWidth,
              transform: `translateX(-50%) scale(${1 / scale})`,
              transformOrigin: "top center",
            }}
            data-node-panel={data.id}
          >
            {renderPanel(data)}
          </div>
        )
      ) : null}
    </div>
  );
});

function ResizeHandle({
  corner,
  onPointerDown,
}: {
  corner: ResizeCorner;
  onPointerDown: (event: React.PointerEvent, corner: ResizeCorner) => void;
}) {
  const positionClass = {
    "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
    "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
    "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
    "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
  }[corner];

  return (
    <div
      className={`absolute z-50 size-7 touch-none ${positionClass}`}
      onPointerDown={(event) => onPointerDown(event, corner)}
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    />
  );
}

function ConnectionHandleDot({
  side,
  visible,
  onMouseDown,
}: {
  side: "left" | "right";
  visible: boolean;
  onMouseDown: (event: React.MouseEvent) => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];

  return (
    <div
      className={`absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
        side === "left" ? "-left-6" : "-right-6"
      } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
      onMouseDown={onMouseDown}
    >
      <div
        className="size-3 rounded-full border-2 transition-all hover:scale-125"
        style={{ background: theme.node.panel, borderColor: theme.node.muted }}
      />
    </div>
  );
}
