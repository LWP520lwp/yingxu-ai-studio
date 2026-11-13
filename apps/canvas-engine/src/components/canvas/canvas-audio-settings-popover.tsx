import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";
import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  AudioSettingsPanel,
  type AudioSettingKey,
} from "@/components/audio-settings-panel";
import {
  audioFormatLabel,
  audioSpeedLabel,
  audioVoiceLabel,
} from "@/lib/audio-generation";
import {
  positionAudioSettingsPopover,
  type AudioPopoverPlacement,
} from "@/atlas-engine/ui/audio-settings-popover";
import { useCanvasPopover } from "@/hooks/use-canvas-popover";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

export type CanvasAudioSettingKey = AudioSettingKey;

type AudioSettingsProps = {
  config: AiConfig;
  onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
  buttonClassName?: string;
  placement?: AudioPopoverPlacement;
};

export function CanvasAudioSettingsPopover({
  config,
  onConfigChange,
  buttonClassName,
  placement = "topLeft",
}: AudioSettingsProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const [open, setOpen] = useState(false);
  const { anchorRef, panelRef, anchorRect } = useCanvasPopover<
    HTMLSpanElement,
    HTMLDivElement
  >(open, (reason) => setPopoverOpen(false, reason === "escape"));

  function setPopoverOpen(next: boolean, restoreFocus = false) {
    setOpen(next);
    if (restoreFocus)
      requestAnimationFrame(() =>
        anchorRef.current?.querySelector("button")?.focus(),
      );
  }

  const position =
    open && anchorRect
      ? positionAudioSettingsPopover(
          anchorRect,
          { width: window.innerWidth, height: window.innerHeight },
          placement,
        )
      : null;
  const panel =
    position && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t("settingsPanels.audio.title")}
            className="canvas-audio-settings-popover thin-scrollbar"
            style={{
              position: "fixed",
              zIndex: 1200,
              width: position.width,
              left: position.left,
              top: position.top,
              bottom: position.bottom,
              maxHeight: position.maxHeight,
              background: theme.toolbar.panel,
              border: `1px solid ${theme.node.stroke}`,
              borderRadius: 8,
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.18)",
              padding: 16,
              overflowY: "auto",
              color: theme.node.text,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <AudioSettingsPanel
              config={config}
              onConfigChange={onConfigChange}
              theme={theme}
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
            buttonClassName || "!h-8 !max-w-[170px] !justify-start !px-2.5"
          }
          style={{ background: theme.node.fill, color: theme.node.text }}
          icon={<Settings2 className="size-3.5" aria-hidden="true" />}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("settingsPanels.audio.title")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setPopoverOpen(!open)}
        >
          <span className="truncate" aria-hidden="true">
            {audioVoiceLabel(config.audioVoice)} ·{" "}
            {audioFormatLabel(config.audioFormat)} ·{" "}
            {audioSpeedLabel(config.audioSpeed)}
          </span>
        </Button>
      </span>
      {panel}
    </>
  );
}
