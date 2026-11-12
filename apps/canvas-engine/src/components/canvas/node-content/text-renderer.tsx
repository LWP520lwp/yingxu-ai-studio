import { ChevronRight, Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasNodeText } from "@/types/canvas";

import { CanvasResourceMentionTextarea } from "../canvas-resource-mention-textarea";
import { BatchFrame } from "./batch-frame";
import type { NodeContentRendererProps } from "./contracts";
import { expandedBatchCardPosition, primaryTextSlot } from "./slot-view-model";
import { TextSlotStatus } from "./status-renderers";

const selectionBlue = "#2f80ff";

export function TextNodeContent({
  node,
  theme,
  isEditingContent,
  textareaRef,
  mentionReferences,
  batchExpanded,
  onContentChange,
  onStopEditing,
  onRetry,
  onToggleBatch,
  onSetBatchPrimary,
}: NodeContentRendererProps) {
  const { t } = useTranslation();
  const fontSize = node.metadata?.fontSize || 14;
  const textStyle = {
    fontSize: `${fontSize}px`,
    lineHeight: `${Math.round(fontSize * 1.65)}px`,
    color: theme.node.text,
    boxSizing: "border-box",
  } as React.CSSProperties;
  const texts = node.metadata?.texts || [];
  const batchCount = texts.length;
  const isBatchRoot = batchCount > 1;
  const { text: primaryText, content: primaryTextContent } =
    primaryTextSlot(node);
  const content = primaryTextContent || "";
  const primaryTextId = primaryText?.id;
  const paddingClass = isBatchRoot ? "px-4 pb-4 pt-14" : "p-4";

  return (
    <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded}>
      {batchExpanded
        ? texts
            .filter((text) => text.id !== primaryTextId)
            .map((text, index) => (
              <ExpandedTextCard
                key={text.id}
                node={node}
                text={text}
                index={index}
                onSetPrimary={() => onSetBatchPrimary?.(text.id)}
                onRetry={onRetry ? () => onRetry(node) : undefined}
              />
            ))
        : null}
      <div className="flex h-full w-full flex-col overflow-hidden rounded-3xl">
        {isEditingContent ? (
          <CanvasResourceMentionTextarea
            ref={textareaRef}
            className={`thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent m-0 font-mono outline-none select-text appearance-none ${paddingClass}`}
            style={textStyle}
            value={content}
            references={mentionReferences}
            highlightLabels={false}
            onChange={(value) => onContentChange(node.id, value)}
            onBlur={onStopEditing}
            onKeyDown={(event) => {
              if (event.key === "Escape") onStopEditing();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          />
        ) : content ? (
          <div
            className={`thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent font-mono ${paddingClass}`}
            style={textStyle}
            onWheel={(event) => event.stopPropagation()}
          >
            {content}
          </div>
        ) : primaryText ? (
          <TextSlotStatus
            text={primaryText}
            onRetry={onRetry ? () => onRetry(node) : undefined}
          />
        ) : (
          <div
            className="p-4 font-mono"
            style={{ color: theme.node.placeholder }}
          >
            {t("canvas.node.editText")}
          </div>
        )}
      </div>
      {isBatchRoot ? (
        <button
          type="button"
          className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(28,25,23,.12)] backdrop-blur-md transition hover:scale-[1.02]"
          style={{
            background: theme.toolbar.panel,
            borderColor: theme.toolbar.border,
            color: theme.toolbar.activeText,
          }}
          aria-label={
            batchExpanded
              ? t("canvas.node.textBatchExpanded")
              : t("canvas.node.textBatchCollapsed")
          }
          onClick={(event) => {
            event.stopPropagation();
            onToggleBatch?.();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="leading-none">
            {t("canvas.controls.texts", { count: batchCount })}
          </span>
          <ChevronRight
            className={`size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}`}
          />
        </button>
      ) : null}
    </BatchFrame>
  );
}

function ExpandedTextCard({
  node,
  text,
  index,
  onSetPrimary,
  onRetry,
}: {
  node: CanvasNodeData;
  text: CanvasNodeText;
  index: number;
  onSetPrimary: () => void;
  onRetry?: () => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const count = node.metadata?.texts?.length || 0;
  const { x, y } = expandedBatchCardPosition(
    index,
    count,
    node.width,
    node.height,
  );

  return (
    <div
      className="absolute z-20 overflow-hidden rounded-3xl border shadow-[0_18px_50px_rgba(28,25,23,.14)]"
      style={
        {
          left: x,
          top: y,
          width: node.width,
          height: node.height,
          background: theme.node.panel,
          borderColor: theme.node.stroke,
          "--batch-from-x": `${-x}px`,
          "--batch-from-y": `${-y}px`,
          "--batch-from-rotate": `${4 + index * 2}deg`,
          animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`,
        } as React.CSSProperties
      }
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {text.content ? (
        <>
          <div
            className="thin-scrollbar h-full overflow-y-auto whitespace-pre-wrap break-words px-4 pb-4 pt-14 font-mono text-sm leading-6"
            style={{ color: theme.node.text }}
            onWheel={(event) => event.stopPropagation()}
          >
            {text.content}
          </div>
          <button
            type="button"
            className="pointer-events-none absolute right-2.5 top-2.5 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium opacity-0 transition duration-150 hover:bg-black/5 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/node:pointer-events-auto group-hover/node:opacity-100 group-focus-within/node:pointer-events-auto group-focus-within/node:opacity-100 dark:hover:bg-white/10"
            style={{ color: theme.node.text }}
            onClick={(event) => {
              event.stopPropagation();
              onSetPrimary();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            aria-label={t("canvas.node.setPrimaryText")}
            title={t("canvas.node.setPrimaryText")}
          >
            <Star className="size-3.5" style={{ color: selectionBlue }} />
            {t("canvas.node.setPrimaryText")}
          </button>
        </>
      ) : (
        <TextSlotStatus text={text} onRetry={onRetry} />
      )}
    </div>
  );
}
