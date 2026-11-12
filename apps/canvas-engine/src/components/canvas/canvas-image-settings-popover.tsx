import { useId, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Settings2, X } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import {
  ImageSettingsPanel,
  imageQualityLabel,
  imageSizeLabel,
} from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { useCanvasPopover } from "@/hooks/use-canvas-popover";

type PopoverProps = {
  config: AiConfig;
  onConfigChange: (key: keyof AiConfig, value: string) => void;
  onMissingConfig?: () => void;
  onOpenChange?: (open: boolean) => void;
  buttonClassName?: string;
  getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
  placement?:
    "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
  autoAdjustOverflow?: boolean;
};

export type SettingsAnchorRect = Pick<
  DOMRect,
  "left" | "right" | "top" | "bottom" | "width"
>;
export type SettingsPopoverPlacement = NonNullable<PopoverProps["placement"]>;

export function settingsPopoverPosition(
  anchor: SettingsAnchorRect,
  placement: SettingsPopoverPlacement,
  viewport: { width: number; height: number },
  autoAdjustOverflow = true,
): CSSProperties {
  const margin = Math.min(12, Math.max(4, viewport.width / 20));
  const gap = 8;
  const width = Math.max(1, Math.min(356, viewport.width - margin * 2));
  const above = Math.max(0, anchor.top - gap - margin);
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  let opensAbove = placement.startsWith("top");

  if (autoAdjustOverflow && (opensAbove ? above : below) < 180) {
    const alternate = opensAbove ? below : above;
    if (alternate > (opensAbove ? above : below)) opensAbove = !opensAbove;
  }

  const centered = placement === "top" || placement === "bottom";
  const alignEnd = placement.endsWith("Right");
  const preferredLeft = centered
    ? anchor.left + anchor.width / 2 - width / 2
    : alignEnd
      ? anchor.right - width
      : anchor.left;
  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const left = Math.max(margin, Math.min(maxLeft, preferredLeft));
  const showBelow = !autoAdjustOverflow && opensAbove && above < 160;
  const fallbackTop = Math.min(
    Math.max(margin, anchor.bottom + gap),
    Math.max(margin, viewport.height - margin - 160),
  );
  const availableHeight = showBelow
    ? viewport.height - fallbackTop - margin
    : opensAbove
      ? above
      : below;

  return {
    position: "fixed",
    zIndex: 1200,
    width,
    left,
    maxHeight: Math.max(1, Math.min(520, availableHeight)),
    overflowY: "auto",
    ...(showBelow
      ? { top: fallbackTop }
      : opensAbove
        ? { bottom: viewport.height - anchor.top + gap }
        : { top: anchor.bottom + gap }),
  };
}

export function CanvasImageSettingsPopover({
  config,
  onConfigChange,
  onOpenChange,
  buttonClassName,
  getPopupContainer,
  placement = "topLeft",
  autoAdjustOverflow = true,
}: PopoverProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const [open, setOpen] = useState(false);
  const { anchorRef, panelRef, anchorRect } = useCanvasPopover<
    HTMLSpanElement,
    HTMLDivElement
  >(open, (reason) => setOpenState(false, reason === "escape"));
  const panelId = `image-settings-${useId().replace(/:/g, "")}`;

  function setOpenState(next: boolean, restoreFocus = false) {
    setOpen(next);
    onOpenChange?.(next);
    if (restoreFocus)
      requestAnimationFrame(() =>
        anchorRef.current?.querySelector("button")?.focus(),
      );
  }

  const quality = config.quality || "auto";
  const count = Math.max(
    1,
    Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)),
  );
  const model =
    (config.model || config.imageModel).split("::").at(-1)?.trim() || "-";
  const target =
    anchorRef.current && getPopupContainer
      ? getPopupContainer(anchorRef.current)
      : typeof document === "undefined"
        ? null
        : document.body;
  const popup =
    open && anchorRect && target
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={`${panelId}-title`}
            className="canvas-image-settings-popover"
            style={{
              ...settingsPopoverPosition(
                anchorRect,
                placement,
                { width: window.innerWidth, height: window.innerHeight },
                autoAdjustOverflow,
              ),
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
                  {t("settingsPanels.image.title")}
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
                onClick={() => setOpenState(false, true)}
              />
            </header>
            <ImageSettingsPanel
              config={config}
              onConfigChange={onConfigChange}
              theme={theme}
              showTitle={false}
              className="space-y-4"
            />
          </div>,
          target,
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
            "!h-8 !max-w-[180px] !justify-start !rounded-full !px-2.5"
          }
          style={{ background: theme.node.fill, color: theme.node.text }}
          icon={<Settings2 className="size-3.5" />}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpenState(!open)}
        >
          <span className="truncate">
            {imageQualityLabel(quality)} ·{" "}
            {imageSizeLabel(config.size || "auto")} ·{" "}
            {t("canvas.controls.images", { count })}
          </span>
        </Button>
      </span>
      {popup}
    </>
  );
}
