import { Puzzle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type {
  CanvasNodeImage,
  CanvasNodeStatus,
  CanvasNodeText,
} from "@/types/canvas";

import type { NodeContentRendererProps } from "./contracts";
import { contentSlotState } from "./slot-view-model";

export function LoadingNodeContent({
  theme,
}: Pick<NodeContentRendererProps, "theme">) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3"
      style={{ color: theme.node.activeStroke }}
    >
      <div
        className="size-10 animate-spin rounded-full border-2"
        style={{
          borderColor: theme.node.stroke,
          borderTopColor: theme.node.activeStroke,
        }}
      />
      <span className="text-[10px] tracking-[0.2em]">
        {t("canvas.node.generating")}
      </span>
    </div>
  );
}

export function ErrorNodeContent({
  node,
  theme,
  onRetry,
}: Pick<NodeContentRendererProps, "node" | "theme"> & {
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
      <div className="text-xs leading-5 text-red-300">
        {node.metadata?.errorDetails || t("canvas.node.failed")}
      </div>
      {onRetry ? (
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
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
      ) : null}
    </div>
  );
}

export function MissingPluginNodeContent({
  theme,
  type,
}: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center"
      style={{ color: theme.node.placeholder }}
    >
      <Puzzle className="size-7 opacity-40" />
      <span className="text-sm">{t("canvas.node.missingPlugin")}</span>
      <span className="text-[11px] opacity-70">
        {t("canvas.node.missingPluginDescription", { type })}
      </span>
    </div>
  );
}

export function TextSlotStatus({
  text,
  onRetry,
}: {
  text: CanvasNodeText;
  onRetry?: () => void;
}) {
  return (
    <SlotStatus
      status={text.status}
      content={text.content}
      errorDetails={text.errorDetails}
      onRetry={onRetry}
    />
  );
}

export function ImageSlotStatus({ image }: { image?: CanvasNodeImage }) {
  return (
    <SlotStatus
      status={image?.status}
      content={image?.content}
      errorDetails={image?.errorDetails}
    />
  );
}

function SlotStatus({
  status,
  content,
  errorDetails,
  onRetry,
}: {
  status?: CanvasNodeStatus;
  content?: string;
  errorDetails?: string;
  onRetry?: () => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const state = contentSlotState(status, content);
  const failed = state === "error";
  const loading = state === "loading";
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center"
      style={{
        background: theme.node.fill,
        color: failed ? theme.node.text : theme.node.activeStroke,
      }}
    >
      {failed ? (
        <span className="text-xs leading-5">
          {errorDetails || t("canvas.node.failed")}
        </span>
      ) : loading ? (
        <div
          className="size-10 animate-spin rounded-full border-2"
          style={{
            borderColor: theme.node.stroke,
            borderTopColor: theme.node.activeStroke,
          }}
        />
      ) : (
        <span className="text-xs">{t("apiErrors.noContent")}</span>
      )}
      {loading ? (
        <span className="text-[10px] tracking-[0.2em]">
          {t("canvas.node.generating")}
        </span>
      ) : null}
      {failed && onRetry ? (
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
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
      ) : null}
    </div>
  );
}
