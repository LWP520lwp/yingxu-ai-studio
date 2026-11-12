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
  ImageSettingsPanel,
  imageQualityLabel,
  imageSizeLabel,
} from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

type CanvasImageSettingsPopoverProps = {
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
export type SettingsPopoverPlacement = NonNullable<
  CanvasImageSettingsPopoverProps["placement"]
>;

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

  if (autoAdjustOverflow) {
    const available = opensAbove ? above : below;
    const alternate = opensAbove ? below : above;
    if (available < 180 && alternate > available) opensAbove = !opensAbove;
  }

  const center = placement === "top" || placement === "bottom";
  const alignRight = placement.endsWith("Right");
  const preferredLeft = center
    ? anchor.left + anchor.width / 2 - width / 2
    : alignRight
      ? anchor.right - width
      : anchor.left;
  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const left = Math.max(margin, Math.min(maxLeft, preferredLeft));
  const forcedVisibleFallback =
    !autoAdjustOverflow && opensAbove && above < 160;
  const fallbackTop = Math.min(
    Math.max(margin, anchor.bottom + gap),
    Math.max(margin, viewport.height - margin - 160),
  );
  const maxHeight = forcedVisibleFallback
    ? Math.max(1, Math.min(520, viewport.height - fallbackTop - margin))
    : Math.max(1, Math.min(520, opensAbove ? above : below));

  return {
    position: "fixed",
    zIndex: 1200,
    width,
    left,
    maxHeight,
    overflowY: "auto",
    ...(forcedVisibleFallback
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
}: CanvasImageSettingsPopoverProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const buttonRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const panelId = `image-settings-${useId().replace(/:/g, "")}`;
  const quality = config.quality || "auto";
  const count = Math.max(
    1,
    Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)),
  );
  const activeSize = config.size || "auto";
  const model = modelLabel(config.model || config.imageModel);

  const updateOpen = (nextOpen: boolean, restoreFocus = false) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
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
  }, [onOpenChange, open]);

  const popupTarget =
    buttonRef.current && getPopupContainer
      ? getPopupContainer(buttonRef.current)
      : typeof document === "undefined"
        ? null
        : document.body;
  const panel =
    open && buttonRect && popupTarget ? (
      <ImageSettingsPortal
        id={panelId}
        buttonRect={buttonRect}
        panelRef={panelRef}
        placement={placement}
        autoAdjustOverflow={autoAdjustOverflow}
        theme={theme}
        title={t("settingsPanels.image.title")}
        modelCaption={`${t("model")}: ${model}`}
        closeLabel={t("common.cancel")}
        config={config}
        onClose={() => updateOpen(false, true)}
        onConfigChange={onConfigChange}
        target={popupTarget}
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
            "!h-8 !max-w-[180px] !justify-start !rounded-full !px-2.5"
          }
          style={{ background: theme.node.fill, color: theme.node.text }}
          icon={<Settings2 className="size-3.5" />}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => updateOpen(!open)}
        >
          <span className="truncate">
            {imageQualityLabel(quality)} · {imageSizeLabel(activeSize)} ·{" "}
            {t("canvas.controls.images", { count })}
          </span>
        </Button>
      </span>
      {panel}
    </>
  );
}

function ImageSettingsPortal({
  id,
  buttonRect,
  panelRef,
  placement,
  autoAdjustOverflow,
  theme,
  title,
  modelCaption,
  closeLabel,
  config,
  onClose,
  onConfigChange,
  target,
}: {
  id: string;
  buttonRect: DOMRect;
  panelRef: RefObject<HTMLDivElement | null>;
  placement: SettingsPopoverPlacement;
  autoAdjustOverflow: boolean;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  title: string;
  modelCaption: string;
  closeLabel: string;
  config: AiConfig;
  onClose: () => void;
  onConfigChange: (key: keyof AiConfig, value: string) => void;
  target: HTMLElement;
}) {
  const style = {
    ...settingsPopoverPosition(
      buttonRect,
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
  } satisfies CSSProperties;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-labelledby={`${id}-title`}
      className="canvas-image-settings-popover"
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
      <ImageSettingsPanel
        config={config}
        onConfigChange={(key, value) => onConfigChange(key, value)}
        theme={theme}
        showTitle={false}
        className="space-y-4"
      />
    </div>,
    target,
  );
}

function modelLabel(value: string) {
  return value.split("::").at(-1)?.trim() || "-";
}
