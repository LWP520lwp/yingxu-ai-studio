import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import {
  normalizeReasoningEffort,
  REASONING_EFFORTS,
} from "@/atlas-engine/ui/text-generation-settings";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

type TextSettingsPanelProps = {
  config: AiConfig;
  onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
  theme: CanvasTheme;
  className?: string;
};

export function TextSettingsPanel({
  config,
  onConfigChange,
  theme,
  className = "space-y-4",
}: TextSettingsPanelProps) {
  const { t } = useTranslation();
  const effort = normalizeReasoningEffort(config.reasoningEffort);

  return (
    <ImageSettingsTheme theme={theme}>
      <section
        className={className}
        style={{ color: theme.node.text }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={t("settingsPanels.text.title")}
      >
        <h2 className="text-base font-semibold">
          {t("settingsPanels.text.title")}
        </h2>
        <fieldset className="space-y-2">
          <legend
            className="text-sm font-medium"
            style={{ color: theme.node.muted }}
          >
            {t("settingsPanels.text.reasoning")}
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {REASONING_EFFORTS.map((value) => {
              const selected = effort === value;
              return (
                <label
                  key={value}
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring/50"
                  style={{
                    borderColor: selected
                      ? theme.node.activeStroke
                      : theme.node.stroke,
                    background: selected ? theme.node.fill : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="reasoning-effort"
                    value={value}
                    checked={selected}
                    onChange={() => onConfigChange("reasoningEffort", value)}
                    className="accent-current"
                  />
                  <span>{t(`settingsPanels.common.${value}`)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </section>
    </ImageSettingsTheme>
  );
}

export function reasoningEffortLabel(value: ReasoningEffort) {
  return i18n.t(`settingsPanels.common.${normalizeReasoningEffort(value)}`);
}
