import { useId, useState } from "react";
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
import { useCanvasPopover } from "@/hooks/use-canvas-popover";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

type TextSettingsProps = {
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
}: TextSettingsProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const [open, setOpen] = useState(false);
  const id = useId().replace(/:/g, "");
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

  const position: TextSettingsPopoverPosition | null = anchorRect
    ? placeTextSettingsPopover(
        anchorRect,
        { width: window.innerWidth, height: window.innerHeight },
        placement,
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
            "!h-8 !max-w-[170px] !justify-start !rounded-full !px-2.5"
          }
          style={{ background: theme.node.fill, color: theme.node.text }}
          icon={<Settings2 className="size-3.5" aria-hidden="true" />}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-panel` : undefined}
          aria-label={t("canvas.controls.reasoning")}
          onClick={() => setPopoverOpen(!open)}
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
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={`${id}-panel`}
              role="dialog"
              aria-labelledby={`${id}-title`}
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
                borderRadius: 8,
                boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
                padding: 16,
                color: theme.node.text,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id={`${id}-title`} className="mb-3 text-sm font-semibold">
                {t("settingsPanels.text.title")}
              </h2>
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
                    htmlFor={`${id}-count`}
                  >
                    {t("settingsPanels.text.count")}
                  </label>
                  <InputNumber
                    id={`${id}-count`}
                    className="w-full"
                    min={1}
                    max={15}
                    precision={0}
                    value={clampTextGenerationCount(count)}
                    onChange={(value) =>
                      onCountChange(clampTextGenerationCount(value))
                    }
                  />
                </div>
              ) : null}
              <Button
                className="mt-4 w-full"
                onClick={() => setPopoverOpen(false, true)}
              >
                {t("common.done")}
              </Button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
