import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import {
  audioFormatOptions,
  audioSpeedLabel,
  audioSpeedPresets,
  audioVoiceOptions,
  normalizeAudioFormatValue,
  normalizeAudioSpeedValue,
  normalizeAudioVoiceValue,
  type AudioFormat,
  type AudioVoice,
} from "@/lib/audio-generation";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

export type AudioSettingKey =
  "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type AudioSettingsPanelProps = {
  config: AiConfig;
  onConfigChange: (key: AudioSettingKey, value: string) => void;
  theme: CanvasTheme;
  showTitle?: boolean;
  className?: string;
};

type Choice = { value: string; label: string };

export function AudioSettingsPanel({
  config,
  onConfigChange,
  theme,
  showTitle = true,
  className = "w-[320px] space-y-4 px-1 py-0.5",
}: AudioSettingsPanelProps) {
  const { t } = useTranslation();
  const voice = normalizeAudioVoiceValue(config.audioVoice);
  const format = normalizeAudioFormatValue(config.audioFormat);
  const speed = normalizeAudioSpeedValue(config.audioSpeed);

  return (
    <ImageSettingsTheme theme={theme}>
      <div
        className={className}
        style={{ color: theme.node.text }}
        onMouseDown={stopCanvasMouseDown}
      >
        {showTitle ? (
          <h2 className="text-base font-semibold">
            {t("settingsPanels.audio.title")}
          </h2>
        ) : null}

        <SettingGroup
          title={t("settingsPanels.audio.voice")}
          color={theme.node.muted}
        >
          <ChoiceGrid
            label={t("settingsPanels.audio.voice")}
            columns={3}
            value={voice}
            options={audioVoiceOptions}
            theme={theme}
            onChange={(value) =>
              onConfigChange("audioVoice", value as AudioVoice)
            }
          />
        </SettingGroup>

        <SettingGroup
          title={t("settingsPanels.audio.format")}
          color={theme.node.muted}
        >
          <ChoiceGrid
            label={t("settingsPanels.audio.format")}
            columns={3}
            value={format}
            options={audioFormatOptions}
            theme={theme}
            onChange={(value) =>
              onConfigChange("audioFormat", value as AudioFormat)
            }
          />
        </SettingGroup>

        <SettingGroup
          title={t("settingsPanels.audio.speed")}
          color={theme.node.muted}
        >
          <ChoiceGrid
            label={t("settingsPanels.audio.speed")}
            columns={4}
            value={speed}
            options={audioSpeedPresets.map((value) => ({
              value,
              label: audioSpeedLabel(value),
            }))}
            theme={theme}
            onChange={(value) => onConfigChange("audioSpeed", value)}
          />
          <input
            type="number"
            min={0.25}
            max={4}
            step={0.05}
            inputMode="decimal"
            aria-label={t("settingsPanels.audio.speed")}
            className="h-9 w-full rounded-md border bg-transparent px-3 text-center text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            style={inputStyle(theme)}
            value={config.audioSpeed}
            onChange={(event) =>
              onConfigChange("audioSpeed", event.currentTarget.value)
            }
            onBlur={(event) =>
              onConfigChange(
                "audioSpeed",
                normalizeAudioSpeedValue(event.currentTarget.value),
              )
            }
            onMouseDown={stopCanvasMouseDown}
          />
        </SettingGroup>

        <SettingGroup
          title={t("settingsPanels.audio.instructions")}
          color={theme.node.muted}
        >
          <textarea
            value={config.audioInstructions}
            aria-label={t("settingsPanels.audio.instructions")}
            placeholder={t("settingsPanels.audio.instructionsPlaceholder")}
            className="thin-scrollbar h-20 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm leading-5 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            style={{
              borderColor: theme.node.stroke,
              color: theme.node.text,
            }}
            onChange={(event) =>
              onConfigChange("audioInstructions", event.currentTarget.value)
            }
            onMouseDown={stopCanvasMouseDown}
          />
        </SettingGroup>
      </div>
    </ImageSettingsTheme>
  );
}

function ChoiceGrid({
  label,
  columns,
  value,
  options,
  theme,
  onChange,
}: {
  label: string;
  columns: number;
  value: string;
  options: readonly Choice[];
  theme: CanvasTheme;
  onChange: (value: string) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta) return;
    event.preventDefault();
    const current = options.findIndex((option) => option.value === value);
    const index = (current + delta + options.length) % options.length;
    const next = options[index];
    if (!next) return;
    onChange(next.value);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>("[role='radio']")
      [index]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="min-h-9 min-w-0 cursor-pointer truncate rounded-md border px-2 text-sm transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            style={choiceStyle(theme, selected)}
            onMouseDown={stopCanvasMouseDown}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function choiceStyle(theme: CanvasTheme, selected: boolean): CSSProperties {
  return {
    color: selected ? theme.toolbar.activeText : theme.node.text,
    background: selected ? theme.toolbar.activeBg : "transparent",
    borderColor: selected ? theme.node.activeStroke : theme.node.stroke,
  };
}

function inputStyle(theme: CanvasTheme): CSSProperties {
  return {
    borderColor: theme.node.stroke,
    color: theme.node.text,
    WebkitTextFillColor: theme.node.text,
  };
}

function stopCanvasMouseDown(event: ReactMouseEvent) {
  event.stopPropagation();
}

function SettingGroup({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-medium" style={{ color }}>
        {title}
      </h3>
      {children}
    </section>
  );
}
