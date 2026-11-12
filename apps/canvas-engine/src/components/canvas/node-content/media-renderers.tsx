import { Group, Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { NodeContentRendererProps } from "./contracts";

export function GroupNodeContent({
  node,
  theme,
  groupChildCount,
}: NodeContentRendererProps) {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none flex h-full w-full p-3">
      <div
        className="flex h-7 max-w-full items-center gap-2 px-1 text-xs font-medium"
        style={{ color: theme.node.text }}
      >
        <Group
          className="size-3.5 shrink-0"
          style={{ color: theme.node.muted }}
        />
        <span className="truncate">{node.title || t("canvas.node.group")}</span>
        <span
          className="shrink-0 text-[11px] font-normal"
          style={{ color: theme.node.muted }}
        >
          {t("canvas.node.nodeCount", { count: groupChildCount })}
        </span>
      </div>
    </div>
  );
}

export function VideoNodeContent({ node, theme }: NodeContentRendererProps) {
  const { t } = useTranslation();
  if (!node.metadata?.content) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-3"
        style={{ color: theme.node.placeholder }}
      >
        <Video className="size-7 opacity-35" />
        <span className="text-sm">{t("canvas.node.emptyVideo")}</span>
      </div>
    );
  }
  return (
    <video
      src={node.metadata.content}
      controls
      className="h-full w-full rounded-[18px] bg-black object-contain"
      data-canvas-video={node.id}
      data-canvas-no-zoom
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    />
  );
}

export function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
  const { t } = useTranslation();
  if (!node.metadata?.content) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-2"
        style={{ color: theme.node.placeholder }}
      >
        <Music2 className="size-7 opacity-35" />
        <span className="text-sm">{t("canvas.node.emptyAudio")}</span>
      </div>
    );
  }
  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-3 px-4"
      style={{ background: theme.node.fill, color: theme.node.text }}
    >
      <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
        <Music2 className="size-4 shrink-0" />
        <span className="truncate">{t("canvas.node.audio")}</span>
      </div>
      <audio
        src={node.metadata.content}
        controls
        className="w-full"
        data-canvas-no-zoom
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      />
    </div>
  );
}
