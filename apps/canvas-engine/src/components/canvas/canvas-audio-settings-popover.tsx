import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";
import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import {
  audioFormatLabel,
  audioSpeedLabel,
  audioVoiceLabel,
} from "@/lib/audio-generation";
import {
  positionAudioSettingsPopover,
  type AudioPopoverAnchor,
  type AudioPopoverPlacement,
} from "@/lib/canvas/audio-settings-popover";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { AudioSettingKey } from "@/components/audio-settings-panel";

export type CanvasAudioSettingKey = AudioSettingKey;

type CanvasAudioSettingsPopoverProps = {
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
}: CanvasAudioSettingsPopoverProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AudioPopoverAnchor | null>(null);

  useEffect(() => {
    if (!open) return;

    let frame = 0;
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
      });
    };
    const scheduleMeasure = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };

    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleMeasure);
    if (triggerRef.current) resizeObserver?.observe(triggerRef.current);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    window.addEventListener("pointerdown", closeWhenOutside, true);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      window.removeEventListener("pointerdown", closeWhenOutside, true);
    };
  }, [open]);

  const position =
    open && anchor
      ? positionAudioSettingsPopover(
          anchor,
          { width: window.innerWidth, height: window.innerHeight },
          placement,
        )
      : null;
  const popoverStyle: CSSProperties | undefined = position
    ? {
        position: "fixed",
        zIndex: 1200,
        width: position.width,
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        maxHeight: position.maxHeight,
        background: theme.toolbar.panel,
        border: `1px solid ${theme.node.stroke}`,
        borderRadius: 12,
        boxShadow: "0 16px 40px rgba(0, 0, 0, 0.18)",
        padding: 16,
        overflowY: "auto",
        color: theme.node.text,
      }
    : undefined;

  return (
    <>
      <span ref={triggerRef} className="inline-flex min-w-0">
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
          onClick={() => setOpen((current) => !current)}
        >
          <span className="truncate" aria-hidden="true">
            {audioVoiceLabel(config.audioVoice)} ·{" "}
            {audioFormatLabel(config.audioFormat)} ·{" "}
            {audioSpeedLabel(config.audioSpeed)}
          </span>
        </Button>
      </span>

      {position && popoverStyle
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={t("settingsPanels.audio.title")}
              className="canvas-audio-settings-popover thin-scrollbar"
              style={popoverStyle}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setOpen(false);
                  triggerRef.current?.querySelector("button")?.focus();
                }
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
        : null}
    </>
  );
}
