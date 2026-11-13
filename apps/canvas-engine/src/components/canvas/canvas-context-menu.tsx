import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  BetweenHorizontalStart,
  GalleryHorizontalEnd,
  GalleryHorizontal,
  Group,
  Copy,
  Trash2,
  Ungroup,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";
import type { AtlasVideoFramePosition as VideoFramePosition } from "@/atlas-engine/workflows/video-frame";

type Props = {
  menu: ContextMenuState;
  canCaptureVideoFrame: boolean;
  canGroup?: boolean;
  canUngroup?: boolean;
  onClose: () => void;
  onCaptureVideoFrame: (position: VideoFramePosition) => void;
  onDuplicate: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onDelete: () => void;
};
type Entry = {
  id: string;
  text: string;
  icon: ReactNode;
  run: () => void;
  danger?: boolean;
};

/** A bounded keyboard menu; focus and dismissal are scoped to this popup. */
export function CanvasNodeContextMenu(props: Props) {
  const { menu, onClose } = props;
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });
  const entries: Entry[] = [];
  if (props.canCaptureVideoFrame) {
    for (const [id, icon] of [
      ["first", <BetweenHorizontalStart className="size-4" />],
      ["last", <GalleryHorizontalEnd className="size-4" />],
      ["current", <GalleryHorizontal className="size-4" />],
    ] as const) {
      entries.push({
        id,
        text: t(`canvas.videoFrames.${id}`),
        icon,
        run: () => props.onCaptureVideoFrame(id),
      });
    }
  }
  if (menu.type === "node") {
    if (props.canGroup && props.onGroup)
      entries.push({
        id: "group",
        text: t("canvas.nodeToolbar.group"),
        icon: <Group className="size-4" />,
        run: props.onGroup,
      });
    if (props.canUngroup && props.onUngroup)
      entries.push({
        id: "ungroup",
        text: t("canvas.nodeToolbar.ungroup"),
        icon: <Ungroup className="size-4" />,
        run: props.onUngroup,
      });
    entries.push({
      id: "duplicate",
      text: t("canvas.controls.duplicate"),
      icon: <Copy className="size-4" />,
      run: props.onDuplicate,
    });
  }
  entries.push({
    id: "delete",
    text: t("canvas.controls.delete"),
    icon: <Trash2 className="size-4" />,
    run: props.onDelete,
    danger: true,
  });
  useLayoutEffect(() => {
    const popup = root.current;
    if (!popup) return;
    const previous = document.activeElement;
    const rect = popup.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    });
    popup.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!popup.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("resize", onClose);
      if (
        popup.contains(document.activeElement) &&
        previous instanceof HTMLElement &&
        previous.isConnected
      )
        previous.focus();
    };
  }, [menu.x, menu.y, onClose]);
  return (
    <div
      ref={root}
      role="menu"
      aria-label="节点菜单"
      className="fixed z-[80] min-w-48 rounded-xl border p-1 shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.node.text,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = Array.from(
          root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ||
            [],
        );
        const current = buttons.indexOf(document.activeElement as HTMLElement);
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[index]?.focus();
      }}
    >
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
          style={{ color: entry.danger ? "#f87171" : theme.node.text }}
          onClick={() => {
            onClose();
            entry.run();
          }}
        >
          {entry.icon}
          <span>{entry.text}</span>
        </button>
      ))}
    </div>
  );
}
