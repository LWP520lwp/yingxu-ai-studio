import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { Settings2, X } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import {
  VideoSettingsPanel,
  videoModeLabel,
  videoResolutionLabel,
  videoSecondsLabel,
  videoSizeLabel,
} from "@/components/video-settings-panel";
import {
  settingsPopoverPosition,
  type SettingsPopoverPlacement,
} from "@/components/canvas/canvas-image-settings-popover";
import { useCanvasPopover } from "@/hooks/use-canvas-popover";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

type VideoSettingsProps = {
  config: AiConfig;
  onConfigChange: (key: keyof AiConfig, value: string) => void;
  buttonClassName?: string;
  placement?: SettingsPopoverPlacement;
};

export function CanvasVideoSettingsPopover({
  config,
  onConfigChange,
  buttonClassName,
  placement = "topLeft",
}: VideoSettingsProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const [open, setOpen] = useState(false);
  const { anchorRef, panelRef, anchorRect } = useCanvasPopover<
    HTMLSpanElement,
    HTMLDivElement
  >(open, (reason) => setPopoverOpen(false, reason === "escape"));
  const panelId = `video-settings-${useId().replace(/:/g, "")}`;

  function setPopoverOpen(next: boolean, restoreFocus = false) {
    setOpen(next);
    if (restoreFocus)
      requestAnimationFrame(() =>
        anchorRef.current?.querySelector("button")?.focus(),
      );
  }

  const model =
    (config.model || config.videoModel).split("::").at(-1)?.trim() || "-";
  const popup =
    open && anchorRect && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={`${panelId}-title`}
            className="canvas-video-settings-popover"
            style={{
              ...settingsPopoverPosition(anchorRect, placement, {
                width: window.innerWidth,
                height: window.innerHeight,
              }),
              boxSizing: "border-box",
              background: theme.toolbar.panel,
              border: `1px solid ${theme.toolbar.border}`,
              borderRadius: 8,
              boxShadow: "0 16px 44px rgba(0, 0, 0, 0.24)",
              padding: 14,
              color: theme.node.text,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <header
              className="mb-3 flex items-start justify-between gap-3 border-b pb-2"
              style={{ borderColor: theme.toolbar.border }}
            >
              <div className="min-w-0">
                <h2 id={`${panelId}-title`} className="text-sm font-semibold">
                  {t("settingsPanels.video.title")}
                </h2>
                <p
                  className="mt-1 truncate text-xs"
                  style={{ color: theme.node.muted }}
                  title={`${t("model")}: ${model}`}
                >
                  {t("model")}: {model}
                </p>
              </div>
              <Button
                type="text"
                size="small"
                aria-label={t("common.cancel")}
                title={t("common.cancel")}
                icon={<X className="size-4" />}
                onClick={() => setPopoverOpen(false, true)}
              />
            </header>
            <VideoSettingsPanel
              config={config}
              onConfigChange={onConfigChange}
              theme={theme}
              showTitle={false}
              className="space-y-4"
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <span ref={anchorRef} className="inline-flex min-w-0">
        <Button
          size="small"
          type="text"
          className={
            buttonClassName ||
            "!h-8 !max-w-[220px] !justify-start !rounded-full !px-2.5"
          }
          style={{ background: theme.node.fill, color: theme.node.text }}
          icon={<Settings2 className="size-3.5" />}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setPopoverOpen(!open)}
        >
          <span className="truncate">
            {videoResolutionLabel(config.vquality, config.size)} ·{" "}
            {videoSizeLabel(config.size)} ·{" "}
            {videoSecondsLabel(config.videoSeconds)} ·{" "}
            {videoModeLabel(config.videoMode)}
          </span>
        </Button>
      </span>
      {popup}
    </>
  );
}
