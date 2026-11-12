import { useLayoutEffect, useRef, useState } from "react";
import { Film, Group, Ungroup, type LucideIcon } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const BOUNDS_PADDING = 14;
const EDGE_INSET = 12;
const ACTION_GAP = 8;

export type SelectionActionId = "merge" | "group" | "ungroup";

export function selectionActionIds({
  canMerge,
  canGroup,
  canUngroup,
}: {
  canMerge: boolean;
  canGroup: boolean;
  canUngroup: boolean;
}): SelectionActionId[] {
  return [
    ...(canMerge ? (["merge"] as const) : []),
    ...(canGroup ? (["group"] as const) : []),
    ...(canUngroup ? (["ungroup"] as const) : []),
  ];
}

export function placeSelectionToolbar({
  selection,
  toolbar,
  canvas,
}: {
  selection: { left: number; top: number; width: number };
  toolbar: { width: number; height: number };
  canvas: { width: number; height: number };
}) {
  const horizontalGutter = Math.min(EDGE_INSET, canvas.width / 2);
  const maxWidth = Math.max(0, canvas.width - horizontalGutter * 2);
  const width = Math.min(Math.max(0, toolbar.width), maxWidth);
  const minTop = Math.min(
    76,
    Math.max(EDGE_INSET, canvas.height - toolbar.height - EDGE_INSET),
  );
  const bottomInset = canvas.height > 200 ? 96 : EDGE_INSET;
  const maxTop = Math.max(minTop, canvas.height - toolbar.height - bottomInset);
  const centeredLeft = selection.left + selection.width / 2 - width / 2;

  return {
    left: Math.max(
      horizontalGutter,
      Math.min(centeredLeft, canvas.width - width - horizontalGutter),
    ),
    top: Math.max(
      minTop,
      Math.min(selection.top - toolbar.height - ACTION_GAP, maxTop),
    ),
    width,
    maxWidth,
  };
}

type SelectionAction = {
  id: SelectionActionId;
  title: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
};

export function CanvasSelectionToolbar({
  nodes,
  viewport,
  canvasSize,
  showToolbar,
  canGroup,
  canUngroup,
  canMerge = false,
  onMerge,
  onGroup,
  onUngroup,
}: {
  nodes: CanvasNodeData[];
  viewport: ViewportTransform;
  canvasSize: { width: number; height: number };
  showToolbar: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canMerge?: boolean;
  onMerge?: () => void;
  onGroup: () => void;
  onUngroup: () => void;
}) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 360, height: 48 });
  const actions = selectionActionIds({
    canMerge: canMerge && Boolean(onMerge),
    canGroup,
    canUngroup,
  }).map((id): SelectionAction => {
    switch (id) {
      case "merge":
        return {
          id,
          title: "按选择的视频创建合成预览，可调整顺序、选段和音量",
          label: "合成预览",
          icon: Film,
          onClick: onMerge!,
        };
      case "group":
        return {
          id,
          title: t("canvas.nodeToolbar.groupTitle"),
          label: t("canvas.nodeToolbar.group"),
          icon: Group,
          onClick: onGroup,
        };
      case "ungroup":
        return {
          id,
          title: t("canvas.nodeToolbar.ungroupTitle"),
          label: t("canvas.nodeToolbar.ungroup"),
          icon: Ungroup,
          onClick: onUngroup,
        };
    }
  });

  useLayoutEffect(() => {
    const element = toolbarRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setToolbarSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showToolbar, actions.length, nodes.length]);

  if (nodes.length < 2) return null;

  const bounds = nodeBounds(nodes);
  const left = viewport.x + bounds.left * viewport.k - BOUNDS_PADDING;
  const top = viewport.y + bounds.top * viewport.k - BOUNDS_PADDING;
  const width = (bounds.right - bounds.left) * viewport.k + BOUNDS_PADDING * 2;
  const height = (bounds.bottom - bounds.top) * viewport.k + BOUNDS_PADDING * 2;
  const showActions = showToolbar && actions.length > 0;
  const placement = placeSelectionToolbar({
    selection: { left, top, width },
    toolbar: toolbarSize,
    canvas: canvasSize,
  });

  return (
    <>
      <div
        className="pointer-events-none absolute z-[65] rounded-xl border border-dashed"
        style={{
          left, top, width, height,
          background: theme.canvas.selectionFill,
          borderColor: theme.canvas.selectionStroke,
          boxShadow: `inset 0 0 0 1px ${theme.canvas.selectionFill}`,
        }}
        aria-hidden="true"
      />
      {showActions ? (
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label="Canvas selection actions"
          className="absolute z-[70] flex h-12 items-center gap-1 overflow-x-auto rounded-lg border px-1 shadow-lg backdrop-blur"
          style={{
            left: placement.left,
            top: placement.top,
            maxWidth: placement.maxWidth,
            background: theme.toolbar.panel,
            borderColor: theme.toolbar.border,
            color: theme.node.text,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {actions.map((action) => (
            <SelectionAction
              key={action.id}
              action={action}
              color={theme.toolbar.item}
              hoverColor={theme.toolbar.itemHover}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function SelectionAction({
  action,
  color,
  hoverColor,
}: {
  action: SelectionAction;
  color: string;
  hoverColor: string;
}) {
  const Icon = action.icon;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <Tooltip title={action.title} placement="top" mouseEnterDelay={0.2}>
      <button
        type="button"
        className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1"
        style={{
          color,
          background: hovered || focused ? hoverColor : "transparent",
        }}
        onClick={action.onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={action.title}
      >
        <Icon className="size-4" aria-hidden="true" />
        <span>{action.label}</span>
      </button>
    </Tooltip>
  );
}
