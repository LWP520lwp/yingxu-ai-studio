import { useState } from "react";
import { Modal, Tooltip } from "antd";
import { Compass, Focus, HelpCircle, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasShortcutCatalog } from "@/atlas-engine/ui/shortcut-catalog";
import { canvasThemes } from "@/lib/canvas-theme";
import {
  ATLAS_ZOOM_LIMITS,
  clampCanvasZoom,
} from "@/atlas-engine/surface/viewport";
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
  const [helpOpen, setHelpOpen] = useState(false);
  const { t } = useTranslation();
  const colorTheme = useThemeStore((state) => state.theme);
  const theme = canvasThemes[colorTheme];
  const zoom = clampCanvasZoom(scale);
  const zoomPercent = Math.round(zoom * 100);
  const shortcuts = canvasShortcutCatalog(t);
  const actions = [
    {
      id: "minimap",
      label: t(isMiniMapOpen ? "canvas.miniMapClose" : "canvas.miniMapOpen"),
      icon: <Compass className="size-4" aria-hidden="true" />,
      active: isMiniMapOpen,
      run: onToggleMiniMap,
    },
    {
      id: "reset",
      label: t("canvas.resetView"),
      icon: <Focus className="size-4" aria-hidden="true" />,
      active: false,
      run: onReset,
    },
    {
      id: "zoom-out",
      label: t("settingsPanels.common.zoomOut"),
      icon: <Minus className="size-3.5" aria-hidden="true" />,
      active: false,
      run: () => onScaleChange(clampCanvasZoom(zoom / 1.2)),
    },
    {
      id: "zoom-in",
      label: t("settingsPanels.common.zoomIn"),
      icon: <Plus className="size-3.5" aria-hidden="true" />,
      active: false,
      run: () => onScaleChange(clampCanvasZoom(zoom * 1.2)),
    },
  ];

  return (
    <>
      <nav
        aria-label={t("canvas.viewControls", { defaultValue: "画布视图控制" })}
        className="absolute bottom-5 left-5 z-50 flex h-12 max-w-[calc(100vw-24px)] items-center gap-1 rounded-lg border p-1.5 shadow-lg"
        style={{
          background: theme.toolbar.panel,
          borderColor: theme.toolbar.border,
          color: theme.toolbar.item,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {actions.map((action) => (
          <Tooltip key={action.id} title={action.label}>
            <button
              type="button"
              aria-label={action.label}
              aria-pressed={action.id === "minimap" ? action.active : undefined}
              className="grid size-8 shrink-0 place-items-center rounded-md outline-none transition hover:brightness-125 focus-visible:ring-2"
              style={{
                background: action.active ? theme.toolbar.activeBg : undefined,
                color: action.active ? theme.toolbar.activeText : undefined,
              }}
              onClick={action.run}
            >
              {action.icon}
            </button>
          </Tooltip>
        ))}
        <input
          type="range"
          min={ATLAS_ZOOM_LIMITS.minScale * 100}
          max={ATLAS_ZOOM_LIMITS.maxScale * 100}
          step={1}
          value={zoomPercent}
          className="mx-1 w-16 accent-current sm:w-24"
          style={{ color: theme.node.activeStroke }}
          onChange={(event) =>
            onScaleChange(clampCanvasZoom(Number(event.target.value) / 100))
          }
          aria-label={t("canvas.zoom")}
          aria-valuetext={`${zoomPercent}%`}
        />
        <output
          className="min-w-10 shrink-0 text-right text-[11px] tabular-nums"
          aria-live="polite"
        >
          {zoomPercent}%
        </output>
        <Tooltip title={t("canvas.shortcuts")}>
          <button
            type="button"
            aria-label={t("canvas.shortcuts")}
            className="grid size-8 shrink-0 place-items-center rounded-md outline-none transition hover:brightness-125 focus-visible:ring-2"
            onClick={() => setHelpOpen(true)}
          >
            <HelpCircle className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </nav>
      <Modal
        title={t("canvas.shortcuts")}
        open={helpOpen}
        onCancel={() => setHelpOpen(false)}
        footer={null}
        centered
        width="min(560px, calc(100vw - 24px))"
      >
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-4 gap-y-3 py-3 text-sm">
          {shortcuts.map(({ id, keys, description }) => (
            <div key={id} className="contents">
              <dt className="flex flex-wrap gap-1">
                {keys.map((key, index) => (
                  <kbd
                    key={`${key}-${index}`}
                    className="rounded border px-1.5 py-1 text-[11px]"
                    style={{ borderColor: theme.node.stroke }}
                  >
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="m-0 self-center text-right opacity-70">
                {description}
              </dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  );
}
