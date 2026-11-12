import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button, InputNumber } from "antd";
import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  reasoningEffortLabel,
  TextSettingsPanel,
} from "@/components/text-settings-panel";
import {
  clampTextGenerationCount,
  placeTextSettingsPopover,
  type TextSettingsPopoverPosition,
  type TextSettingsPlacement,
} from "@/lib/canvas/text-generation-settings";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

type CanvasTextSettingsPopoverProps = {
  config: AiConfig;
  onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
  count?: number;
  onCountChange?: (count: number) => void;
  buttonClassName?: string;
  placement?: TextSettingsPlacement;
};

export function CanvasTextSettingsPopover({
  config,
  onConfigChange,
  count,
  onCountChange,
  buttonClassName,
  placement = "topLeft",
}: CanvasTextSettingsPopoverProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TextSettingsPopoverPosition | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition(
        placeTextSettingsPopover(
          rect,
          { width: window.innerWidth, height: window.innerHeight },
          placement,
        ),
      );
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.querySelector("button")?.focus();
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, placement]);

  return (
    <>
      <span ref={triggerRef} className="inline-flex min-w-0">
        <Button
          size="small"
          type="text"
          className={
            buttonClassName ||
            "!h-8 !max-w-[170px] !justify-start !rounded-full !px-2.5"
          }
          style={{ background: theme.node.fill, color: theme.node.text }}
          icon={<Settings2 className="size-3.5" aria-hidden="true" />}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("canvas.controls.reasoning")}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="truncate">
            {t("canvas.controls.reasoning")} ·{" "}
            {reasoningEffortLabel(config.reasoningEffort)}
            {onCountChange
              ? ` · ${t("canvas.controls.generations", { count })}`
              : ""}
          </span>
        </Button>
      </span>
      {open && position ? (
        <TextSettingsPortal
          position={position}
          panelRef={panelRef}
          theme={theme}
          config={config}
          count={count}
          onConfigChange={onConfigChange}
          onCountChange={onCountChange}
        />
      ) : null}
    </>
  );
}

function TextSettingsPortal({
  position,
  panelRef,
  theme,
  config,
  count,
  onConfigChange,
  onCountChange,
}: {
  position: TextSettingsPopoverPosition;
  panelRef: RefObject<HTMLDivElement | null>;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  config: AiConfig;
  count?: number;
  onConfigChange: CanvasTextSettingsPopoverProps["onConfigChange"];
  onCountChange?: (count: number) => void;
}) {
  const { t } = useTranslation();
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("settingsPanels.text.title")}
      className="canvas-text-settings-popover"
      style={{
        position: "fixed",
        zIndex: 1200,
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
        overflowY: "auto",
        background: theme.toolbar.panel,
        border: `1px solid ${theme.node.stroke}`,
        borderRadius: 12,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 16,
        color: theme.node.text,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <TextSettingsPanel
        config={config}
        onConfigChange={onConfigChange}
        theme={theme}
      />
      {onCountChange ? (
        <div className="mt-4 space-y-2">
          <label
            className="block text-sm font-medium"
            style={{ color: theme.node.muted }}
            htmlFor="canvas-text-generation-count"
          >
            {t("settingsPanels.text.count")}
          </label>
          <InputNumber
            id="canvas-text-generation-count"
            className="w-full"
            min={1}
            max={15}
            precision={0}
            value={clampTextGenerationCount(count)}
            onChange={(value) => onCountChange(clampTextGenerationCount(value))}
          />
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
