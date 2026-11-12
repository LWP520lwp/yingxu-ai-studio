import { useState } from "react";
import { Compass, Focus, HelpCircle, Minus, Plus } from "lucide-react";
import { Modal } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { clampScale } from "@/lib/canvas/canvas-geometry";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
  scale: number;
  onScaleChange: (scale: number) => void;
  onReset: () => void;
  isMiniMapOpen: boolean;
  onToggleMiniMap: () => void;
};

export function CanvasZoomControls({
  scale,
  onScaleChange,
  onReset,
  isMiniMapOpen,
  onToggleMiniMap,
}: CanvasZoomControlsProps) {
  const [help, setHelp] = useState(false);
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const zoom = clampScale(scale);
  const actions = [
    {
      label: t(isMiniMapOpen ? "canvas.miniMapClose" : "canvas.miniMapOpen"),
      icon: <Compass className="size-4" />,
      run: onToggleMiniMap,
      active: isMiniMapOpen,
    },
    {
      label: t("canvas.resetView"),
      icon: <Focus className="size-4" />,
      run: onReset,
    },
    {
      label: "缩小画布",
      icon: <Minus className="size-3.5" />,
      run: () => onScaleChange(clampScale(zoom / 1.2)),
    },
  ];
  const shortcuts = [
    ["拖动空白", "平移画布"],
    ["Shift + 拖动空白", t("canvas.shortcut.boxSelect")],
    ["滚轮 / 触控板", t("canvas.shortcut.zoom")],
    ["Ctrl / Cmd + C / V", t("canvas.shortcut.copyPasteNodes")],
    ["Ctrl / Cmd + G", t("canvas.shortcut.group")],
    ["Ctrl / Cmd + Shift + G", t("canvas.shortcut.ungroup")],
    ["Ctrl / Cmd + Z", t("canvas.undo")],
    ["Ctrl / Cmd + Shift + Z", t("canvas.redo")],
    ["Delete / Backspace", t("canvas.shortcut.delete")],
  ];
  return (
    <>
      <nav
        aria-label="画布视图控制"
        className="absolute bottom-5 left-5 z-50 flex h-12 items-center gap-1 rounded-xl border p-1.5 shadow-lg"
        style={{
          background: theme.toolbar.panel,
          borderColor: theme.toolbar.border,
          color: theme.toolbar.item,
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            aria-label={action.label}
            aria-pressed={action.active}
            title={action.label}
            className="grid size-7 place-items-center rounded-md hover:brightness-125"
            style={{
              background: action.active ? theme.toolbar.activeBg : undefined,
              color: action.active ? theme.toolbar.activeText : undefined,
            }}
            onClick={action.run}
          >
            {action.icon}
          </button>
        ))}
        <input
          type="range"
          min={5}
          max={500}
          step={1}
          value={Math.round(zoom * 100)}
          className="w-16"
          style={{ accentColor: theme.node.activeStroke }}
          onChange={(event) =>
            onScaleChange(clampScale(Number(event.target.value) / 100))
          }
          aria-label={t("canvas.zoom")}
        />
        <button
          type="button"
          aria-label="放大画布"
          title="放大画布"
          className="grid size-7 place-items-center rounded-md hover:brightness-125"
          onClick={() => onScaleChange(clampScale(zoom * 1.2))}
        >
          <Plus className="size-3.5" />
        </button>
        <output className="min-w-9 text-right text-[11px] tabular-nums">
          {Math.round(zoom * 100)}%
        </output>
        <button
          type="button"
          aria-label={t("canvas.shortcuts")}
          title={t("canvas.shortcuts")}
          className="grid size-7 place-items-center rounded-md hover:brightness-125"
          onClick={() => setHelp(true)}
        >
          <HelpCircle className="size-4" />
        </button>
      </nav>
      <Modal
        title={t("canvas.shortcuts")}
        open={help}
        onCancel={() => setHelp(false)}
        footer={null}
        centered
      >
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-6 gap-y-3 py-3 text-sm">
          {shortcuts.map(([key, label]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="rounded border px-2 py-1 text-xs">{key}</kbd>
              </dt>
              <dd className="text-right opacity-70">{label}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  );
}
