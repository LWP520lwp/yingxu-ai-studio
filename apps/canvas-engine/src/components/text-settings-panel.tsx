import { Segmented } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import {
  normalizeReasoningEffort,
  REASONING_EFFORTS,
} from "@/lib/canvas/text-generation-settings";
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
        <div className="space-y-2">
          <h3
            className="text-sm font-medium"
            style={{ color: theme.node.muted }}
          >
            {t("settingsPanels.text.reasoning")}
          </h3>
          <Segmented
            block
            value={effort}
            options={REASONING_EFFORTS.map((value) => ({
              value,
              label: t(`settingsPanels.common.${value}`),
            }))}
            onChange={(value) =>
              onConfigChange("reasoningEffort", value as ReasoningEffort)
            }
          />
        </div>
      </section>
    </ImageSettingsTheme>
  );
}

export function reasoningEffortLabel(value: ReasoningEffort) {
  return i18n.t(`settingsPanels.common.${normalizeReasoningEffort(value)}`);
}
