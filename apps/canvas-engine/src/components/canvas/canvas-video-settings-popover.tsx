import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
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
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

type CanvasVideoSettingsPopoverProps = {
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
}: CanvasVideoSettingsPopoverProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const buttonRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const panelId = `video-settings-${useId().replace(/:/g, "")}`;
  const model = modelLabel(config.model || config.videoModel);

  const updateOpen = (nextOpen: boolean, restoreFocus = false) => {
    setOpen(nextOpen);
    if (restoreFocus)
      requestAnimationFrame(() =>
        buttonRef.current?.querySelector("button")?.focus(),
      );
  };

  useEffect(() => {
    if (!open) return;
    const syncPosition = () =>
      setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        buttonRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      )
        return;
      if (
        document.activeElement instanceof HTMLElement &&
        panelRef.current?.contains(document.activeElement)
      )
        document.activeElement.blur();
      updateOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      updateOpen(false, true);
    };

    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
      window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  const panel =
    open && buttonRect ? (
      <VideoSettingsPortal
        id={panelId}
        buttonRect={buttonRect}
        panelRef={panelRef}
        placement={placement}
        theme={theme}
        title={t("settingsPanels.video.title")}
        modelCaption={`${t("model")}: ${model}`}
        closeLabel={t("common.cancel")}
        config={config}
        onClose={() => updateOpen(false, true)}
        onConfigChange={onConfigChange}
      />
    ) : null;

  return (
    <>
      <span ref={buttonRef} className="inline-flex min-w-0">
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
          onClick={() => updateOpen(!open)}
        >
          <span className="truncate">
            {videoResolutionLabel(config.vquality, config.size)} ·{" "}
            {videoSizeLabel(config.size)} ·{" "}
            {videoSecondsLabel(config.videoSeconds)} ·{" "}
            {videoModeLabel(config.videoMode)}
          </span>
        </Button>
      </span>
      {panel}
    </>
  );
}

function VideoSettingsPortal({
  id,
  buttonRect,
  panelRef,
  placement,
  theme,
  title,
  modelCaption,
  closeLabel,
  config,
  onClose,
  onConfigChange,
}: {
  id: string;
  buttonRect: DOMRect;
  panelRef: RefObject<HTMLDivElement | null>;
  placement: SettingsPopoverPlacement;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  title: string;
  modelCaption: string;
  closeLabel: string;
  config: AiConfig;
  onClose: () => void;
  onConfigChange: (key: keyof AiConfig, value: string) => void;
}) {
  const style = {
    ...settingsPopoverPosition(buttonRect, placement, {
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
  } satisfies CSSProperties;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-labelledby={`${id}-title`}
      className="canvas-video-settings-popover"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="mb-3 flex items-start justify-between gap-3 border-b pb-2"
        style={{ borderColor: theme.toolbar.border }}
      >
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-sm font-semibold">
            {title}
          </h2>
          <div
            className="mt-1 truncate text-xs"
            style={{ color: theme.node.muted }}
            title={modelCaption}
          >
            {modelCaption}
          </div>
        </div>
        <Button
          type="text"
          size="small"
          aria-label={closeLabel}
          title={closeLabel}
          icon={<X className="size-4" />}
          onClick={onClose}
        />
      </div>
      <VideoSettingsPanel
        config={config}
        onConfigChange={(key, value) => onConfigChange(key, value)}
        theme={theme}
        showTitle={false}
        className="space-y-4"
      />
    </div>,
    document.body,
  );
}

function modelLabel(value: string) {
  return value.split("::").at(-1)?.trim() || "-";
}
